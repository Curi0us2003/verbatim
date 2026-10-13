import { useMemo, useState } from "react";
import { ChevronDown, Sparkles } from "lucide-react";
import type { Exchange, Turn } from "@/types";
import { InsightCard } from "@/components/InsightCard";
import { TurnBubble } from "@/components/TurnBubble";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  turns: Turn[];
  exchanges: Exchange[];
  time: number;
  query: string;
  onSeek: (seconds: number) => void;
}

interface Row {
  key: string;
  turns: Turn[];
  exchange: Exchange | null;
}

/**
 * Transcript in the left two-thirds, each exchange's insight card beside it on the right,
 * so the card scrolls together with the exchange it belongs to.
 */
export function TranscriptView({ turns, exchanges, time, query, onSeek }: Props) {
  const rows = useMemo(() => groupRows(turns, exchanges), [turns, exchanges]);
  const activeId = turns.find((t) => time >= t.start && time < t.end)?.id;

  return (
    <div className="space-y-10">
      {rows.map((row) => (
        <section key={row.key} className="grid gap-4 lg:grid-cols-3 lg:gap-8">
          <div className="space-y-4 lg:col-span-2">
            {row.turns.map((t) => (
              <TurnBubble key={t.id} turn={t} active={t.id === activeId} query={query} onSeek={onSeek} />
            ))}
          </div>
          {row.exchange && (
            <>
              <aside className="hidden lg:block" aria-label={`AI interpretation for exchange ${row.exchange.index + 1}`}>
                <div className="sticky top-24">
                  <InsightCard exchange={row.exchange} />
                </div>
              </aside>
              <MobileInsight exchange={row.exchange} />
            </>
          )}
        </section>
      ))}
    </div>
  );
}

/** On small screens the insight opens as a panel under its exchange. */
function MobileInsight({ exchange }: { exchange: Exchange }) {
  const [open, setOpen] = useState(false);
  const panelId = `insight-panel-${exchange.id}`;
  return (
    <div className="lg:hidden">
      <Button variant="outline" size="sm" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls={panelId}>
        <Sparkles /> AI interpretation
        <ChevronDown className={cn("transition-transform", open && "rotate-180")} />
      </Button>
      {open && (
        <div id={panelId} className="mt-3 animate-slide-up">
          <InsightCard exchange={exchange} />
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
