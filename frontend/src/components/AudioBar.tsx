import type { RefObject } from "react";
import { Keyboard, Pause, Play, RotateCcw, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatTime } from "@/lib/utils";

interface Props {
  audioRef: RefObject<HTMLAudioElement>;
  src: string | null;
  time: number;
  duration: number;
  playing: boolean;
  onTogglePlay: () => void;
  onSeek: (seconds: number) => void;
  onSkip: (delta: number) => void;
  unavailableReason?: string;
}

/** Audio player pinned to the bottom of the review screen (F3). */
export function AudioBar({ audioRef, src, time, duration, playing, onTogglePlay, onSeek, onSkip, unavailableReason }: Props) {
  const disabled = !src;
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 backdrop-blur print:hidden">
      {src && <audio ref={audioRef} src={src} preload="metadata" />}
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-3 sm:gap-3 sm:px-6">
        <Button variant="ghost" size="icon" onClick={() => onSkip(-5)} disabled={disabled} aria-label="Back 5 seconds (J)" title="Back 5 s (J)">
          <RotateCcw />
        </Button>
        <Button
          size="icon"
          className="rounded-full"
          onClick={onTogglePlay}
          disabled={disabled}
          aria-label={playing ? "Pause (Space)" : "Play (Space)"}
          title={playing ? "Pause (Space)" : "Play (Space)"}
        >
          {playing ? <Pause /> : <Play />}
        </Button>
        <Button variant="ghost" size="icon" onClick={() => onSkip(5)} disabled={disabled} aria-label="Forward 5 seconds (L)" title="Forward 5 s (L)">
          <RotateCw />
        </Button>
        {disabled ? (
          <p className="flex-1 text-sm text-muted-foreground">{unavailableReason ?? "No audio for this session."}</p>
        ) : (
          <>
            <span className="w-24 shrink-0 text-center font-mono text-xs tabular-nums text-muted-foreground">
              {formatTime(time)} / {formatTime(duration)}
            </span>
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.1}
              value={Math.min(time, duration || 0)}
              onChange={(e) => onSeek(Number(e.target.value))}
              className="h-1.5 min-w-0 flex-1 cursor-pointer accent-[var(--sage)]"
              aria-label="Playback position"
            />
          </>
        )}
        <span className="hidden items-center gap-1 text-xs text-muted-foreground lg:flex" title="Keyboard shortcuts">
          <Keyboard className="h-3.5 w-3.5" aria-hidden /> Space · J/L · E
        </span>
      </div>
    </div>
  );
}
