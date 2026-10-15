import { useEffect, useRef, useState } from "react";
import { AudioLines, Mic, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/api";
import type { VoiceInfo } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { formatDate } from "@/lib/utils";

const TARGET_SEC = 20;
const MIN_SEC = 12;
const PASSAGE =
  "Thank you for coming in today. Before we begin, I'd like you to know that this is a safe space, " +
  "and you can take your time. You don't have to answer anything you don't want to. " +
  "Shall we start with how your week has been? What has been on your mind the most?";
const MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];

/** Settings card: save the counsellor's voiceprint so voice analysis knows who the counsellor is. */
export function VoiceEnrollCard() {
  const [info, setInfo] = useState<VoiceInfo | null>(null);
  const [seconds, setSeconds] = useState<number | null>(null); // null = not recording
  const [busy, setBusy] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const startedAt = useRef(0);

  useEffect(() => {
    api.voice().then(setInfo, () => setInfo({ enrolled: false }));
  }, []);

  // Timer; stops by itself at the target length.
  const isRecording = seconds !== null;
  useEffect(() => {
    if (!isRecording) return;
    const t = setInterval(() => {
      const s = (performance.now() - startedAt.current) / 1000;
      setSeconds(s);
      if (s >= TARGET_SEC) recorder.current?.stop();
    }, 200);
    return () => clearInterval(t);
  }, [isRecording]);

  // Release the microphone if the page is left mid-recording.
  useEffect(() => () => recorder.current?.stream.getTracks().forEach((t) => t.stop()), []);

  const start = async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      toast.error("Microphone access was blocked or no microphone was found.");
      return;
    }
    const mimeType = MIME_TYPES.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
    const ext = mimeType.includes("mp4") ? ".mp4" : mimeType.includes("ogg") ? ".ogg" : ".webm";
    const rec = new MediaRecorder(stream, { mimeType: mimeType || undefined });
    const parts: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const length = (performance.now() - startedAt.current) / 1000;
      setSeconds(null);
      if (length < MIN_SEC) {
        toast.error(`That was only ${Math.round(length)} seconds. Please read for at least ${MIN_SEC} seconds.`);
        return;
      }
      setBusy(true);
      try {
        setInfo(await api.enrollVoice(new Blob(parts, { type: mimeType || "audio/webm" }), ext));
        toast.success("Your voice is saved", { description: "New sessions will recognise you as the counsellor." });
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setBusy(false);
      }
    };
    recorder.current = rec;
    rec.start();
    startedAt.current = performance.now();
    setSeconds(0);
  };

  const remove = async () => {
    setBusy(true);
    try {
      setInfo(await api.deleteVoice());
      toast.success("Your voiceprint was deleted");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AudioLines className="h-5 w-5 text-sage" aria-hidden /> Your voice
        </CardTitle>
        <CardDescription>
          Teach Verbatim what you sound like, so voice analysis always knows which speaker is the counsellor. Only a
          voice fingerprint (a list of numbers) is kept, encrypted on this computer. The recording itself is deleted
          straight away.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {info?.enrolled ? (
          <p className="text-sm">
            <span className="font-medium text-primary">Saved.</span> Learned from {Math.round(info.seconds ?? 0)} seconds
            of your speech ({info.source}
            {info.updated_at ? `, ${formatDate(info.updated_at)}` : ""}). You can add more with ⋯ → “Learn my voice
            from this session” on any session where the roles are correct.
          </p>
        ) : (
          info && <p className="text-sm text-muted-foreground">Not set up yet. It takes about 20 seconds.</p>
        )}

        {isRecording ? (
          <div className="space-y-3 rounded-xl border border-sage/40 bg-sage/5 p-4">
            <p className="text-sm font-medium">Read this aloud in your normal counselling voice:</p>
            <p className="transcript-text">“{PASSAGE}”</p>
            <Progress value={Math.min(100, ((seconds ?? 0) / TARGET_SEC) * 100)} aria-label="Recording progress" />
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm tabular-nums text-muted-foreground" role="status">
                {Math.floor(seconds ?? 0)} / {TARGET_SEC} s
              </span>
              <Button variant="outline" size="sm" onClick={() => recorder.current?.stop()} disabled={(seconds ?? 0) < MIN_SEC}>
                <Square /> Finish
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button onClick={start} disabled={busy}>
              <Mic /> {info?.enrolled ? "Record again" : "Record my voice (20 s)"}
            </Button>
            {info?.enrolled && (
              <Button variant="ghost" onClick={remove} disabled={busy}>
                <Trash2 /> Delete voiceprint
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
