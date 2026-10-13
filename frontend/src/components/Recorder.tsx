import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Mic, MicOff, Pause, Play, Square, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/api";
import type { NoiseLevel, SessionMeta } from "@/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn, formatTime } from "@/lib/utils";

const CHUNK_MS = 30_000; // F2: a crash loses at most 30 seconds
const MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];

type Phase = "idle" | "testing" | "recording" | "paused" | "finishing";

interface Props {
  meta: SessionMeta;
  ready: boolean;
  onSuggestNoise: (level: NoiseLevel) => void;
  onFinished: (sessionId: number) => void;
  onActiveChange?: (active: boolean) => void;
}

function extFor(mime: string): string {
  if (mime.includes("mp4")) return ".mp4";
  if (mime.includes("ogg")) return ".ogg";
  return ".webm";
}

/** Live recording (F2) with a level meter, background-noise check and 30-second chunk uploads. */
export function Recorder({ meta, ready, onSuggestNoise, onFinished, onActiveChange }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [noiseFloor, setNoiseFloor] = useState<number | null>(null); // dBFS of the quietest moments
  const [browserNoise, setBrowserNoise] = useState(true);
  const [pendingUploads, setPendingUploads] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const frameRef = useRef(0);
  const sessionRef = useRef<number | null>(null);
  const chunkIndex = useRef(0);
  const uploadChain = useRef<Promise<void>>(Promise.resolve());
  const clock = useRef({ startedAt: 0, banked: 0 });
  const quietSamples = useRef<number[]>([]);

  const active = phase === "recording" || phase === "paused" || phase === "finishing";
  useEffect(() => onActiveChange?.(active), [active, onActiveChange]);

  // Warn before closing the tab while recording (F2).
  useEffect(() => {
    if (!active) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [active]);

  // Running timer that ignores paused time.
  useEffect(() => {
    if (phase !== "recording") return;
    const t = setInterval(() => setElapsed(clock.current.banked + (performance.now() - clock.current.startedAt) / 1000), 250);
    return () => clearInterval(t);
  }, [phase]);

  const stopMic = useCallback(() => {
    cancelAnimationFrame(frameRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void ctxRef.current?.close().catch(() => undefined);
    ctxRef.current = null;
    setLevel(0);
  }, []);

  // On leaving the page: stop the recorder so the last chunk is still uploaded, then release the mic.
  useEffect(
    () => () => {
      if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
      stopMic();
    },
    [stopMic],
  );

  const openMic = async (): Promise<MediaStream | null> => {
    setMicError(null);
    stopMic();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: browserNoise, // the browser's own background-noise filter
          autoGainControl: true,
        },
      });
      streamRef.current = stream;
      const ctx = new AudioContext();
      ctxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      quietSamples.current = [];
      let last = 0;
      const tick = (now: number) => {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += v * v;
        const db = 20 * Math.log10(Math.sqrt(sum / buf.length) + 1e-9);
        setLevel(Math.max(0, Math.min(1, (db + 60) / 50)));
        // Track the quietest moments to estimate steady background noise (fans, traffic, hum).
        if (now - last > 100) {
          last = now;
          const q = quietSamples.current;
          q.push(db);
          if (q.length > 60) q.shift();
          if (q.length >= 20) setNoiseFloor([...q].sort((a, b) => a - b)[Math.floor(q.length * 0.1)]);
        }
        frameRef.current = requestAnimationFrame(tick);
      };
      frameRef.current = requestAnimationFrame(tick);
      return stream;
    } catch (e) {
      const err = e as DOMException;
      setMicError(
        err.name === "NotAllowedError"
          ? "Microphone access was blocked. Allow it in the browser's address bar, then try again."
          : "No microphone was found. Check it is plugged in and selected in Windows sound settings.",
      );
      return null;
    }
  };

  const testMic = async () => {
    if (await openMic()) setPhase("testing");
  };

  const upload = (index: number, blob: Blob, ext: string) => {
    const id = sessionRef.current!;
    setPendingUploads((n) => n + 1);
    uploadChain.current = uploadChain.current.then(async () => {
      for (let attempt = 1; ; attempt++) {
        try {
          await api.sendChunk(id, index, blob, ext);
          break;
        } catch (e) {
          if (attempt >= 6) {
            toast.error(`Could not save part ${index + 1} of the recording`, { description: (e as Error).message });
            break;
          }
          await new Promise((r) => setTimeout(r, 2000 * attempt));
        }
      }
      setPendingUploads((n) => n - 1);
    });
  };

  const start = async () => {
    const stream = streamRef.current ?? (await openMic());
    if (!stream) return;
    let session;
    try {
      session = await api.createSession(meta);
    } catch (e) {
      toast.error((e as Error).message);
      return;
    }
    sessionRef.current = session.id;
    chunkIndex.current = 0;
    const mimeType = MIME_TYPES.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
    const ext = extFor(mimeType);
    const recorder = new MediaRecorder(stream, { mimeType: mimeType || undefined, audioBitsPerSecond: 64_000 });
    recorderRef.current = recorder;
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) upload(chunkIndex.current++, e.data, ext);
    };
    recorder.onstop = async () => {
      setPhase("finishing");
      await uploadChain.current; // every chunk saved before finishing
      stopMic();
      try {
        const done = await api.finish(session.id);
        toast.success("Recording saved", { description: "Transcription has started." });
        onFinished(done.id);
      } catch (e) {
        toast.error((e as Error).message);
        setPhase("idle");
      }
    };
    recorder.start(CHUNK_MS);
    clock.current = { startedAt: performance.now(), banked: 0 };
    setElapsed(0);
    setPhase("recording");
  };

  const pause = () => {
    recorderRef.current?.pause();
    clock.current.banked += (performance.now() - clock.current.startedAt) / 1000;
    setPhase("paused");
  };
  const resume = () => {
    recorderRef.current?.resume();
    clock.current.startedAt = performance.now();
    setPhase("recording");
  };
  const stop = () => {
    if (phase === "recording") clock.current.banked += (performance.now() - clock.current.startedAt) / 1000;
    recorderRef.current?.stop();
  };

  const noisy = noiseFloor !== null && noiseFloor > -50;
  const veryNoisy = noiseFloor !== null && noiseFloor > -38;
  const bars = 24;

  return (
    <div className="flex flex-col items-center gap-6 py-4">
      {active && (
        <p role="status" className="flex items-center gap-2 rounded-full bg-risk/10 px-4 py-1.5 text-sm font-medium text-risk">
          <span className={cn("h-2.5 w-2.5 rounded-full bg-risk", phase === "recording" && "animate-pulse")} aria-hidden />
          {phase === "recording" ? "Recording — keep this tab open" : phase === "paused" ? "Paused" : "Saving the recording…"}
        </p>
      )}

      {phase === "idle" || phase === "testing" ? (
        <button
          type="button"
          disabled={!ready}
          onClick={start}
          className={cn(
            "flex h-28 w-28 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform",
            "hover:scale-105 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background",
            "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100",
          )}
          aria-label="Start recording"
        >
          <Mic className="h-10 w-10" aria-hidden />
        </button>
      ) : (
        <div className="flex h-28 w-28 items-center justify-center rounded-full border-4 border-risk/40 bg-risk/10 text-risk" aria-hidden>
          <Mic className={cn("h-10 w-10", phase === "recording" && "animate-pulse")} />
        </div>
      )}

      <p className="font-mono text-3xl tabular-nums" aria-label="Recording time" aria-live="off">
        {formatTime(elapsed)}
      </p>

      <div className="flex h-8 items-end gap-1" title="Microphone level" aria-label={`Microphone level ${Math.round(level * 100)}%`} role="meter" aria-valuenow={Math.round(level * 100)} aria-valuemin={0} aria-valuemax={100}>
        {Array.from({ length: bars }, (_, i) => {
          const on = level * bars > i;
          return (
            <span
              key={i}
              className={cn("w-1.5 rounded-full transition-colors", on ? (i > bars * 0.85 ? "bg-risk" : "bg-sage") : "bg-muted")}
              style={{ height: `${30 + (i / bars) * 70}%` }}
            />
          );
        })}
      </div>

      {(phase === "recording" || phase === "paused") && (
        <div className="flex gap-2">
          {phase === "recording" ? (
            <Button variant="outline" size="lg" onClick={pause}><Pause /> Pause</Button>
          ) : (
            <Button variant="outline" size="lg" onClick={resume}><Play /> Resume</Button>
          )}
          <Button variant="destructive" size="lg" onClick={stop}><Square /> Stop</Button>
        </div>
      )}
      {phase === "finishing" && pendingUploads > 0 && (
        <p className="text-sm text-muted-foreground">Uploading the last {pendingUploads} part{pendingUploads > 1 ? "s" : ""}…</p>
      )}

      {(phase === "idle" || phase === "testing") && (
        <div className="w-full max-w-md space-y-4">
          <div className="flex items-start gap-3">
            <Checkbox
              id="browser-noise"
              checked={browserNoise}
              onCheckedChange={(c) => {
                setBrowserNoise(c === true);
                if (phase === "testing") stopMic(), setPhase("idle");
              }}
              className="mt-0.5"
            />
            <Label htmlFor="browser-noise" className="font-normal leading-relaxed">
              Reduce background noise while recording
              <span className="block text-xs text-muted-foreground">
                Uses the browser's noise suppression and echo cancellation. Turn off only if soft speech gets cut out.
              </span>
            </Label>
          </div>
          {phase === "idle" ? (
            <Button variant="outline" className="w-full" onClick={testMic}><Volume2 /> Test microphone and room noise</Button>
          ) : (
            <div className="space-y-2 rounded-xl border p-3 text-sm">
              <p>Speak normally to see the meter move, then stay quiet for a few seconds to measure the room.</p>
              {noiseFloor === null ? (
                <p className="text-muted-foreground">Measuring background noise…</p>
              ) : veryNoisy ? (
                <NoiseHint tone="risk" text="It's very noisy here. If you can, move somewhere quieter. Strong noise reduction will help." onUse={() => onSuggestNoise("strong")} current={meta.noise_reduction} />
              ) : noisy ? (
                <NoiseHint tone="warn" text="Some background noise detected (fan, AC or traffic). Strong noise reduction is recommended." onUse={() => onSuggestNoise("strong")} current={meta.noise_reduction} />
              ) : (
                <p className="text-primary">The room sounds quiet. Light noise reduction is fine.</p>
              )}
              <Button variant="ghost" size="sm" onClick={() => (stopMic(), setPhase("idle"))}><MicOff /> Stop test</Button>
            </div>
          )}
          {micError && <p role="alert" className="rounded-lg bg-risk/10 p-3 text-sm text-risk">{micError}</p>}
          {!ready && (
            <p className="text-center text-sm text-muted-foreground">
              Fill in the title and client code, and tick the consent box to enable recording.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function NoiseHint({ tone, text, onUse, current }: { tone: "risk" | "warn"; text: string; onUse: () => void; current: NoiseLevel }) {
  return (
    <div className={cn("flex items-start gap-2", tone === "risk" ? "text-risk" : "text-client-ink")}>
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="space-y-1">
        <p>{text}</p>
        {current !== "strong" ? (
          <Button size="sm" variant="outline" onClick={onUse}>Use strong noise reduction</Button>
        ) : (
          <p className="text-xs">Strong noise reduction is selected.</p>
        )}
      </div>
    </div>
  );
}
