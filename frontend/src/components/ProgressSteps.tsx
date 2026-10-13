import { Check, Circle, CircleDot, XCircle } from "lucide-react";
import type { SessionStatus } from "@/types";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

// F5 stages, each with a friendly message (UI guidelines → Feedback).
export const STAGES: { status: SessionStatus; label: string; message: string }[] = [
  { status: "uploading", label: "Uploading", message: "Receiving the recording…" },
  { status: "converting", label: "Converting", message: "Getting the audio ready and softening background noise…" },
  { status: "transcribing", label: "Transcribing", message: "Listening to the recording…" },
  { status: "diarizing", label: "Identifying speakers", message: "Working out who said what…" },
  { status: "ready", label: "Ready", message: "Your transcript is ready to review." },
  { status: "insights", label: "Generating insights", message: "Reading each exchange carefully…" },
];

interface Props {
  current: SessionStatus | null;
  percent?: number;
  failedAt?: SessionStatus | null;
  showInsights?: boolean;
}

/** Vertical list of pipeline stages with a progress bar on the active one. */
export function ProgressSteps({ current, percent, failedAt, showInsights = true }: Props) {
  const stages = showInsights ? STAGES : STAGES.filter((s) => s.status !== "insights");
  const currentIndex = current ? stages.findIndex((s) => s.status === (failedAt ?? current)) : -1;
  const failed = !!failedAt;

  return (
    <ol className="space-y-3" aria-label="Processing steps">
      {stages.map((stage, i) => {
        const done = i < currentIndex || (stage.status === "ready" && currentIndex >= i && !failed);
        const active = i === currentIndex && !done;
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
            <div className="min-w-0 flex-1">
              <p className={cn("text-sm font-medium", !done && !active && "text-muted-foreground")}>
                {stage.label}
                {stage.status === "insights" && <span className="font-normal text-muted-foreground"> (optional)</span>}
              </p>
              {active && !failed && (
                <div className="mt-1 space-y-2">
                  <p className="text-sm text-muted-foreground" role="status">
                    {stage.message}
                  </p>
                  {percent != null && stage.status !== "ready" && (
                    <Progress value={percent} aria-label={`${stage.label} ${Math.round(percent)}%`} className="max-w-xs" />
                  )}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
