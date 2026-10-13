import { useEffect, useState } from "react";
import { AlertTriangle, MessageCircleQuestion, Sparkles, ThumbsDown, ThumbsUp } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/api";
import { isInsight, type Exchange } from "@/types";
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

interface Props {
  exchange: Exchange;
  generating?: boolean;
  onChange?: (exchange: Exchange) => void;
}

/** AI interpretation beside one exchange (F4), with the counsellor's own feedback and note. */
export function InsightCard({ exchange, generating, onChange }: Props) {
  const [note, setNote] = useState(exchange.counsellor_note ?? "");
  const [busy, setBusy] = useState(false);
  const insight = exchange.insight_json;
  useEffect(() => setNote(exchange.counsellor_note ?? ""), [exchange.counsellor_note]);

  if (!exchange.client_turn_ids.length) {
    return <Card className="p-4 text-sm text-muted-foreground">No client reply to interpret here.</Card>;
  }
  if (generating && !insight) {
    return (
      <Card className="space-y-3 p-5" aria-busy="true" aria-label="Generating AI interpretation">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-2/3" />
      </Card>
    );
  }
  if (!insight) {
    return (
      <Card className="p-4 text-sm text-muted-foreground">
        No AI interpretation yet. Use <strong>Generate insights</strong> at the top.
      </Card>
    );
  }
  if (!isInsight(insight)) {
    return (
      <Card className="p-4 text-sm">
        <p className="font-medium">Insight unavailable</p>
        <p className="text-muted-foreground">The AI did not give a usable answer for this exchange. Try generating insights again.</p>
      </Card>
    );
  }

  const save = async (changes: Parameters<typeof api.updateExchange>[1], message: string) => {
    setBusy(true);
    try {
      onChange?.(await api.updateExchange(exchange.id, changes));
      toast.success(message);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const feedback = exchange.counsellor_feedback;
  const toggle = (value: "agree" | "disagree") =>
    feedback === value
      ? save({ clear_feedback: true }, "Feedback cleared")
      : save({ counsellor_feedback: value }, value === "agree" ? "Marked as agree" : "Marked as disagree");
  const noteChanged = note.trim() !== (exchange.counsellor_note ?? "");

  return (
    <Card className={cn("space-y-4 p-5 text-sm", insight.risk_flag && "border-2 border-risk")}>
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5" aria-hidden />
        AI interpretation — not a clinical judgement
      </p>

      {insight.risk_flag && (
        <div role="alert" className="flex gap-2 rounded-lg bg-risk/10 p-3 text-risk">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            <strong>Possible risk: </strong>
            {insight.risk_note || "Please review this exchange."}
          </span>
        </div>
      )}

      <p className="leading-relaxed">{insight.client_meaning}</p>

      {insight.evidence.length > 0 && (
        <ul className="space-y-1 border-l-2 border-client-border pl-3 italic text-muted-foreground" aria-label="Client's words">
          {insight.evidence.map((quote, i) => (
            <li key={i}>“{quote}”</li>
          ))}
        </ul>
      )}

      {insight.emotions.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Emotions expressed">
          {insight.emotions.map((emotion, i) => (
            <Badge key={i} variant="secondary">
              {emotion}
            </Badge>
          ))}
        </div>
      )}

      {insight.underlying_need && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">Possible underlying need</p>
          <p>{insight.underlying_need}</p>
        </div>
      )}

      {insight.suggested_follow_up && (
        <div className="flex items-start gap-2 rounded-lg bg-muted p-3">
          <MessageCircleQuestion className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
          <div>
            <p className="text-xs font-medium text-muted-foreground">Suggested follow-up</p>
            <p>{insight.suggested_follow_up}</p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <span className={cn("whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium", CONFIDENCE_STYLE[insight.confidence])}>
          {insight.confidence} confidence
        </span>
        <div className="flex gap-1">
          <Button variant={feedback === "agree" ? "default" : "ghost"} size="sm" aria-pressed={feedback === "agree"} disabled={busy} onClick={() => toggle("agree")}>
            <ThumbsUp /> Agree
          </Button>
          <Button variant={feedback === "disagree" ? "default" : "ghost"} size="sm" aria-pressed={feedback === "disagree"} disabled={busy} onClick={() => toggle("disagree")}>
            <ThumbsDown /> Disagree
          </Button>
        </div>
      </div>

      <div>
        <label htmlFor={`note-${exchange.id}`} className="mb-1 block text-xs font-medium text-muted-foreground">
          Your note (kept separate from the AI text)
        </label>
        <Textarea
          id={`note-${exchange.id}`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Add your own reading…"
          rows={2}
        />
        {noteChanged && (
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setNote(exchange.counsellor_note ?? "")}>
              Undo
            </Button>
            <Button size="sm" disabled={busy} onClick={() => save({ counsellor_note: note }, "Note saved")}>
              Save note
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
