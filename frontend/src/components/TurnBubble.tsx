import { Fragment, useEffect, useRef, useState } from "react";
import { ArrowLeftRight, MoreHorizontal, NotebookPen, Pencil, Scissors, UserRound } from "lucide-react";
import type { Turn } from "@/types";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { cn, formatTime } from "@/lib/utils";

const UNCLEAR_BELOW = 0.4; // F1: words under this confidence get a dotted underline
const PAUSE = /^\[pause (\d+)s\]$/;

interface Props {
  turn: Turn;
  active?: boolean;
  query?: string;
  editing?: boolean;
  readOnly?: boolean;
  onSeek?: (seconds: number) => void;
  onStartEdit?: () => void;
  onCancelEdit?: () => void;
  onSaveText?: (text: string) => Promise<void> | void;
  onToggleRole?: () => void;
  onSplit?: () => void;
}

/** One speaker turn: quoted, labelled, colour-coded (F3), editable in place. */
export function TurnBubble({
  turn, active, query, editing, readOnly, onSeek, onStartEdit, onCancelEdit, onSaveText, onToggleRole, onSplit,
}: Props) {
  const isCounsellor = turn.role === "counsellor";
  const Icon = isCounsellor ? NotebookPen : UserRound;
  const other = isCounsellor ? "Client" : "Counsellor";

  return (
    <div className={cn("flex", isCounsellor ? "justify-start" : "justify-end")} data-turn-id={turn.id}>
      <figure
        className={cn(
          "group w-full max-w-[88%] scroll-mt-28 rounded-2xl border px-5 py-4 transition-shadow",
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
            title="Play from here"
          >
            {formatTime(turn.start)}
          </button>
          {turn.edited && <span className="font-normal normal-case tracking-normal text-muted-foreground">· edited</span>}
          {!readOnly && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="ml-auto h-7 w-7 text-muted-foreground opacity-70 group-hover:opacity-100"
                  aria-label="Turn options"
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={onStartEdit}>
                  <Pencil /> Edit text <span className="ml-auto text-xs text-muted-foreground">E</span>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onToggleRole}>
                  <ArrowLeftRight /> Mark as {other}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onSplit}>
                  <Scissors /> Split turn…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </figcaption>
        {editing ? (
          <TurnEditor text={turn.text} onCancel={() => onCancelEdit?.()} onSave={(t) => onSaveText?.(t)} />
        ) : (
          <blockquote
            className={cn("transcript-text rounded-md text-foreground", !readOnly && "cursor-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
            onClick={() => {
              if (!readOnly && !window.getSelection()?.toString()) onStartEdit?.();
            }}
            onKeyDown={(e) => {
              if (!readOnly && e.key === "Enter") {
                e.preventDefault();
                onStartEdit?.();
              }
            }}
            tabIndex={readOnly ? undefined : 0}
            role={readOnly ? undefined : "button"}
            aria-label={readOnly ? undefined : `${isCounsellor ? "Counsellor" : "Client"} said: ${turn.text}. Press Enter to edit.`}
          >
            <span aria-hidden>“</span>
            <TurnText turn={turn} query={query} />
            <span aria-hidden>”</span>
          </blockquote>
        )}
      </figure>
    </div>
  );
}

function TurnEditor({ text, onSave, onCancel }: { text: string; onSave: (t: string) => Promise<void> | void; onCancel: () => void }) {
  const [value, setValue] = useState(text);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, []);
  const save = async () => {
    if (value.trim() === text) return onCancel();
    setSaving(true);
    try {
      await onSave(value);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="space-y-2">
      <Textarea
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void save();
        }}
        className="transcript-text min-h-[96px] bg-card"
        aria-label="Edit what was said"
      />
      <div className="flex items-center justify-end gap-2">
        <span className="mr-auto text-xs text-muted-foreground">Ctrl+Enter to save · Esc to cancel</span>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={() => void save()} disabled={saving || !value.trim()}>
          Save
        </Button>
      </div>
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
              <span
                className="mx-0.5 inline-block rounded-md bg-muted px-1.5 align-middle font-mono text-xs text-muted-foreground"
                title={`Silence of about ${pause[1]} seconds`}
              >
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
              title={`Unclear — confidence ${Math.round(score * 100)}%. Please check against the audio.`}
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
