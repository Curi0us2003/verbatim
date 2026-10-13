import { Fragment } from "react";
import { NotebookPen, UserRound } from "lucide-react";
import type { Turn } from "@/types";
import { cn, formatTime } from "@/lib/utils";

const UNCLEAR_BELOW = 0.4; // F1: words under this confidence get a dotted underline
const PAUSE = /^\[pause (\d+)s\]$/;

interface Props {
  turn: Turn;
  active?: boolean;
  query?: string;
  onSeek?: (seconds: number) => void;
}

/** One speaker turn: quoted, labelled, colour-coded (F3). */
export function TurnBubble({ turn, active, query, onSeek }: Props) {
  const isCounsellor = turn.role === "counsellor";
  const Icon = isCounsellor ? NotebookPen : UserRound;

  return (
    <div className={cn("flex", isCounsellor ? "justify-start" : "justify-end")}>
      <figure
        className={cn(
          "w-full max-w-[88%] rounded-2xl border px-5 py-4 transition-shadow",
          isCounsellor
            ? "rounded-tl-sm border-counsellor-border/50 bg-counsellor"
            : "rounded-tr-sm border-client-border/60 bg-client",
          active && "ring-2 ring-sage ring-offset-2 ring-offset-background",
        )}
        aria-current={active ? "true" : undefined}
      >
        <figcaption
          className={cn(
            "mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide",
            isCounsellor ? "text-counsellor-ink" : "text-client-ink",
          )}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden />
          <span>{isCounsellor ? "Counsellor" : "Client"}</span>
          <button
            type="button"
            onClick={() => onSeek?.(turn.start)}
            className="rounded px-1 font-mono font-normal normal-case tracking-normal underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Play from ${formatTime(turn.start)}`}
          >
            {formatTime(turn.start)}
          </button>
        </figcaption>
        <blockquote className="transcript-text text-foreground">
          <span aria-hidden>“</span>
          <TurnText turn={turn} query={query} />
          <span aria-hidden>”</span>
        </blockquote>
      </figure>
    </div>
  );
}

/** Renders words with [pause Ns] chips, unclear-word underlines and search highlights. */
function TurnText({ turn, query }: { turn: Turn; query?: string }) {
  // Join "[pause" + "4s]" back into one token so markers stay whole.
  const tokens = turn.text.replace(/\[pause (\d+)s\]/g, "[pause_$1s]").split(/\s+/).filter(Boolean);
  // Word confidences only line up with the text until the counsellor edits it.
  const scores = turn.edited ? [] : turn.words_json.map((w) => w.score);
  const q = query?.trim().toLowerCase();
  let wordIndex = 0;

  return (
    <>
      {tokens.map((raw, i) => {
        const token = raw.replace(/^\[pause_(\d+)s\]$/, "[pause $1s]");
        const space = i < tokens.length - 1 ? " " : "";
        const pause = token.match(PAUSE);
        if (pause) {
          return (
            <Fragment key={i}>
              <span className="mx-0.5 inline-block rounded-md bg-muted px-1.5 align-middle font-mono text-xs text-muted-foreground">
                pause {pause[1]}s
              </span>
              {space}
            </Fragment>
          );
        }
        const score = scores[wordIndex++];
        const unclear = score != null && score < UNCLEAR_BELOW;
        const match = q && token.toLowerCase().includes(q);
        let node: React.ReactNode = token;
        if (match) node = <mark className="rounded-sm bg-yellow-200 px-0.5 text-foreground dark:bg-yellow-700/60">{node}</mark>;
        if (unclear)
          node = (
            <span
              className="underline decoration-muted-foreground decoration-dotted decoration-2 underline-offset-4"
              title={`Unclear — confidence ${Math.round(score * 100)}%. Please check.`}
            >
              {node}
            </span>
          );
        return (
          <Fragment key={i}>
            {node}
            {space}
          </Fragment>
        );
      })}
    </>
  );
}
