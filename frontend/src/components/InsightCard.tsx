import { useState } from "react";
import { AlertTriangle, MessageCircleQuestion, Sparkles, ThumbsDown, ThumbsUp } from "lucide-react";
import { toast } from "sonner";
import type { Exchange } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const CONFIDENCE_STYLE = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-counsellor text-counsellor-ink",
  high: "bg-primary/15 text-primary",
} as const;

/** AI interpretation beside one exchange (F4). Saving feedback is wired up in Phase 6. */
export function InsightCard({ exchange, loading }: { exchange: Exchange; loading?: boolean }) {
  const [feedback, setFeedback] = useState(exchange.counsellor_feedback);
  const [note, setNote] = useState(exchange.counsellor_note ?? "");
  const insight = exchange.insight_json;

  if (loading) {
    return (
      <Card className="space-y-3 p-5">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-2/3" />
      </Card>
    );
  }

  if (!insight) {
    return (
      <Card className="p-5 text-sm text-muted-foreground">
        No AI interpretation yet. Use <strong>Generate insights</strong> above.
      </Card>
    );
  }

  const save = (value: typeof feedback) => {
    setFeedback(value);
    toast.success("Feedback saved", { description: "Demo only — saving to the database arrives in Phase 6." });
  };

  return (
    <Card className={cn("space-y-4 p-5 text-sm", insight.risk_flag && "border-risk")}>
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5" aria-hidden />
        AI interpretation — not a clinical judgement
      </p>

      {insight.risk_flag && (
        <div role="alert" className="flex gap-2 rounded-lg bg-risk/10 p-3 text-risk">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{insight.risk_note || "Possible risk mentioned. Please review."}</span>
        </div>
      )}

      <p className="leading-relaxed">{insight.client_meaning}</p>

      {insight.evidence.length > 0 && (
        <ul className="space-y-1 border-l-2 border-client-border pl-3 italic text-muted-foreground">
          {insight.evidence.map((quote) => (
            <li key={quote}>“{quote}”</li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-1.5">
        {insight.emotions.map((emotion) => (
          <Badge key={emotion} variant="secondary">
            {emotion}
          </Badge>
        ))}
      </div>

      <div>
        <p className="text-xs font-medium text-muted-foreground">Possible underlying need</p>
        <p>{insight.underlying_need}</p>
      </div>

      <div className="flex items-start gap-2 rounded-lg bg-muted p-3">
        <MessageCircleQuestion className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
        <div>
          <p className="text-xs font-medium text-muted-foreground">Suggested follow-up</p>
          <p>{insight.suggested_follow_up}</p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t pt-3">
        <span className={cn("whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium", CONFIDENCE_STYLE[insight.confidence])}>
          {insight.confidence} confidence
        </span>
        <div className="flex gap-1">
          <Button
            variant={feedback === "agree" ? "default" : "ghost"}
            size="sm"
            aria-pressed={feedback === "agree"}
            onClick={() => save(feedback === "agree" ? null : "agree")}
          >
            <ThumbsUp /> Agree
          </Button>
          <Button
            variant={feedback === "disagree" ? "default" : "ghost"}
            size="sm"
            aria-pressed={feedback === "disagree"}
            onClick={() => save(feedback === "disagree" ? null : "disagree")}
          >
            <ThumbsDown /> Disagree
          </Button>
        </div>
      </div>

      <div>
        <label htmlFor={`note-${exchange.id}`} className="mb-1 block text-xs font-medium text-muted-foreground">
          Your note
        </label>
        <Textarea
          id={`note-${exchange.id}`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Add your own reading…"
          rows={2}
        />
      </div>
    </Card>
  );
}
