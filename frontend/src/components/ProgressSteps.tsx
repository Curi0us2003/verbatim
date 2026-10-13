import { Check, Circle, CircleDot, XCircle } from "lucide-react";
import type { SessionStatus } from "@/types";
import { cn } from "@/lib/utils";

// F5 stages, each with a friendly message (UI guidelines → Feedback).
export const STAGES: { status: SessionStatus; label: string; message: string }[] = [
  { status: "uploading", label: "Uploading", message: "Receiving the recording…" },
  { status: "converting", label: "Converting", message: "Getting the audio ready…" },
  { status: "transcribing", label: "Transcribing", message: "Listening to the recording…" },
  { status: "diarizing", label: "Identifying speakers", message: "Working out who said what…" },
  { status: "ready", label: "Ready", message: "Your transcript is ready to review." },
  { status: "insights", label: "Generating insights", message: "Reading between the lines…" },
];

/** Vertical list of pipeline stages. `current` is the session status, or null before starting. */
export function ProgressSteps({ current, failed }: { current: SessionStatus | null; failed?: boolean }) {
  const currentIndex = current ? STAGES.findIndex((s) => s.status === current) : -1;

  return (
    <ol className="space-y-3" aria-label="Processing steps">
      {STAGES.map((stage, i) => {
        const done = i < currentIndex || (stage.status === "ready" && currentIndex >= i);
        const active = i === currentIndex && !done;
        const optional = stage.status === "insights";
        const Icon = failed && active ? XCircle : done ? Check : active ? CircleDot : Circle;
        return (
          <li key={stage.status} className="flex items-start gap-3" aria-current={active ? "step" : undefined}>
            <span
              className={cn(
                "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
                done && "border-primary bg-primary text-primary-foreground",
                active && !failed && "border-sage text-sage",
                active && failed && "border-risk text-risk",
                !done && !active && "text-muted-foreground",
              )}
            >
              <Icon className={cn("h-3.5 w-3.5", active && !failed && "animate-pulse")} aria-hidden />
            </span>
            <div>
              <p className={cn("text-sm font-medium", !done && !active && "text-muted-foreground")}>
                {stage.label}
                {optional && <span className="font-normal text-muted-foreground"> (optional)</span>}
              </p>
              {active && <p className="text-sm text-muted-foreground">{stage.message}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
