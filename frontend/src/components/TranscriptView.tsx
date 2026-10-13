import { useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, Sparkles } from "lucide-react";
import { isInsight, type Exchange, type Turn } from "@/types";
import { InsightCard } from "@/components/InsightCard";
import { TurnBubble } from "@/components/TurnBubble";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  turns: Turn[];
  exchanges: Exchange[];
  activeTurnId: number | null;
  editingTurnId: number | null;
  query: string;
  generating: boolean;
  onSeek: (seconds: number) => void;
  onEdit: (turnId: number | null) => void;
  onSaveText: (turn: Turn, text: string) => Promise<void>;
  onToggleRole: (turn: Turn) => void;
  onSplit: (turn: Turn) => void;
  onExchangeChange: (exchange: Exchange) => void;
}

interface Row {
  key: string;
  turns: Turn[];
  exchange: Exchange | null;
}

/**
 * Transcript in the left two-thirds; each exchange's insight card sits beside it on the right
 * (sticky), so the card always scrolls together with the exchange in view.
 */
export function TranscriptView(props: Props) {
  const { turns, exchanges, activeTurnId, editingTurnId, query, generating, onSeek, onEdit, onExchangeChange } = props;
  const rows = useMemo(() => groupRows(turns, exchanges), [turns, exchanges]);

  return (
    <div className="space-y-10">
      {rows.map((row) => {
        const risky = row.exchange && isInsight(row.exchange.insight_json) && row.exchange.insight_json.risk_flag;
        return (
          <section
            key={row.key}
            id={row.exchange ? `exchange-${row.exchange.id}` : undefined}
            className={cn("grid scroll-mt-28 gap-4 lg:grid-cols-3 lg:gap-8", risky && "rounded-2xl")}
            aria-label={row.exchange ? `Exchange ${row.exchange.index + 1}` : undefined}
          >
            <div className="space-y-4 lg:col-span-2">
              {risky && (
                <p className="flex items-center gap-2 rounded-lg bg-risk/10 px-3 py-2 text-sm font-medium text-risk" role="note">
                  <AlertTriangle className="h-4 w-4" aria-hidden /> Possible risk mentioned in this exchange
                </p>
              )}
              {row.turns.map((t) => (
                <TurnBubble
                  key={t.id}
                  turn={t}
                  active={t.id === activeTurnId}
                  editing={t.id === editingTurnId}
                  query={query}
                  onSeek={onSeek}
                  onStartEdit={() => onEdit(t.id)}
                  onCancelEdit={() => onEdit(null)}
                  onSaveText={(text) => props.onSaveText(t, text)}
                  onToggleRole={() => props.onToggleRole(t)}
                  onSplit={() => props.onSplit(t)}
                />
              ))}
            </div>
            {row.exchange && (
              <>
                <aside className="hidden lg:block" aria-label={`AI interpretation for exchange ${row.exchange.index + 1}`}>
                  <div className="sticky top-24">
                    <InsightCard exchange={row.exchange} generating={generating} onChange={onExchangeChange} />
                  </div>
                </aside>
                <MobileInsight exchange={row.exchange} generating={generating} onChange={onExchangeChange} />
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** On small screens the insight opens as a slide-up panel under its exchange. */
function MobileInsight({ exchange, generating, onChange }: { exchange: Exchange; generating: boolean; onChange: (e: Exchange) => void }) {
  const [open, setOpen] = useState(false);
  const panelId = `insight-panel-${exchange.id}`;
  if (!exchange.client_turn_ids.length) return null;
  return (
    <div className="lg:hidden">
      <Button variant="outline" size="sm" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls={panelId}>
        <Sparkles /> AI interpretation
        <ChevronDown className={cn("transition-transform", open && "rotate-180")} />
      </Button>
      {open && (
        <div id={panelId} className="mt-3 animate-slide-up">
          <InsightCard exchange={exchange} generating={generating} onChange={onChange} />
        </div>
      )}
    </div>
  );
}

/** Splits turns into exchange rows; turns outside any exchange get their own row. */
function groupRows(turns: Turn[], exchanges: Exchange[]): Row[] {
  const exchangeOf = new Map<number, Exchange>();
  for (const ex of exchanges) {
    for (const id of [...ex.counsellor_turn_ids, ...ex.client_turn_ids]) exchangeOf.set(id, ex);
  }
  const rows: Row[] = [];
  for (const t of turns) {
    const ex = exchangeOf.get(t.id) ?? null;
    const last = rows[rows.length - 1];
    if (last && ex && last.exchange?.id === ex.id) last.turns.push(t);
    else rows.push({ key: ex ? `ex-${ex.id}` : `turn-${t.id}`, turns: [t], exchange: ex });
  }
  return rows;
}
