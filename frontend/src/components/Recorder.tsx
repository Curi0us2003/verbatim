import { Mic, Pause, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Live recording (F2). This is the layout only; MediaRecorder is wired up in Phase 5. */
export function Recorder({ ready }: { ready: boolean }) {
  const start = () =>
    toast.info("Live recording arrives in Phase 5", {
      description: "This screen shows the layout only for now.",
    });

  return (
    <div className="flex flex-col items-center gap-6 py-4">
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

      <p className="font-mono text-3xl tabular-nums text-muted-foreground" aria-label="Recording time">
        00:00
      </p>

      <div className="flex h-8 items-end gap-1" aria-hidden title="Microphone level">
        {Array.from({ length: 24 }, (_, i) => (
          <span key={i} className="w-1.5 rounded-full bg-muted" style={{ height: `${20 + ((i * 37) % 60)}%` }} />
        ))}
      </div>

      <div className="flex gap-2">
        <Button variant="outline" disabled>
          <Pause /> Pause
        </Button>
        <Button variant="outline" disabled>
          <Square /> Stop
        </Button>
      </div>

      {!ready && (
        <p className="text-center text-sm text-muted-foreground">
          Fill in the title and client code, and tick the consent box to enable recording.
        </p>
      )}
    </div>
  );
}
