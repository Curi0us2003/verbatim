import { useCallback, useEffect, useRef, useState } from "react";

/** State and controls for one <audio> element (the review screen's player). */
export function useAudio(src: string | null) {
  const ref = useRef<HTMLAudioElement>(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    // timeupdate fires only ~4×/s; animation frames keep the highlighted turn in step while playing.
    const tick = () => {
      setTime(el.currentTime);
      if (!el.paused) frame = requestAnimationFrame(tick);
    };
    const onPlay = () => {
      setPlaying(true);
      frame = requestAnimationFrame(tick);
    };
    const onPause = () => {
      setPlaying(false);
      cancelAnimationFrame(frame);
      setTime(el.currentTime);
    };
    const onMeta = () => setDuration(Number.isFinite(el.duration) ? el.duration : 0);
    const onSeeked = () => setTime(el.currentTime);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onPause);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("durationchange", onMeta);
    el.addEventListener("seeked", onSeeked);
    onMeta();
    if (!el.paused) onPlay();
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onPause);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("durationchange", onMeta);
      el.removeEventListener("seeked", onSeeked);
    };
  }, [src]);

  const toggle = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => undefined);
    else el.pause();
  }, []);

  const seek = useCallback((seconds: number, play = false) => {
    const el = ref.current;
    if (!el) return;
    el.currentTime = Math.max(0, Math.min(seconds, el.duration || seconds));
    setTime(el.currentTime);
    if (play) void el.play().catch(() => undefined);
  }, []);

  const skip = useCallback((delta: number) => {
    const el = ref.current;
    if (el) seek(el.currentTime + delta);
  }, [seek]);

  return { ref, time, duration, playing, toggle, seek, skip };
}
