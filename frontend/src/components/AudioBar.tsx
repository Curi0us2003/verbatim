import { Pause, Play, RotateCcw, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatTime } from "@/lib/utils";

interface Props {
  time: number;
  duration: number;
  playing: boolean;
  onTogglePlay: () => void;
  onSeek: (seconds: number) => void;
  note?: string;
}

/** Audio player pinned to the bottom of the review screen (F3). Real audio arrives in Phase 4. */
export function AudioBar({ time, duration, playing, onTogglePlay, onSeek, note }: Props) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
        <Button variant="ghost" size="icon" onClick={() => onSeek(Math.max(0, time - 5))} aria-label="Back 5 seconds">
          <RotateCcw />
        </Button>
        <Button size="icon" className="rounded-full" onClick={onTogglePlay} aria-label={playing ? "Pause" : "Play"}>
          {playing ? <Pause /> : <Play />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onSeek(Math.min(duration, time + 5))}
          aria-label="Forward 5 seconds"
        >
          <RotateCw />
        </Button>
        <span className="w-24 shrink-0 text-center font-mono text-xs text-muted-foreground tabular-nums">
          {formatTime(time)} / {formatTime(duration)}
        </span>
        <input
          type="range"
          min={0}
          max={duration}
          step={0.1}
          value={time}
          onChange={(e) => onSeek(Number(e.target.value))}
          className="h-1.5 flex-1 cursor-pointer accent-[var(--sage)]"
          aria-label="Playback position"
        />
        {note && <span className="hidden text-xs text-muted-foreground md:inline">{note}</span>}
      </div>
    </div>
  );
}
