import { useRef, useState } from "react";
import type { NoiseLevel, Turn } from "@/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/select";
import { NOISE_OPTIONS } from "@/lib/utils";

interface Base {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Split one turn in two where the other speaker starts. */
export function SplitDialog({ open, onOpenChange, turn, onSplit }: Base & { turn: Turn | null; onSplit: (at: number) => Promise<void> }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [at, setAt] = useState(0);
  const [busy, setBusy] = useState(false);
  if (!turn) return null;
  const valid = at > 0 && at < turn.text.length && turn.text.slice(0, at).trim() && turn.text.slice(at).trim();
  const update = () => setAt(ref.current?.selectionStart ?? 0);
  const other = turn.role === "counsellor" ? "client" : "counsellor";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Split this turn</DialogTitle>
          <DialogDescription>
            Click in the text where the other speaker starts talking. The second part will be marked as the {other}.
          </DialogDescription>
        </DialogHeader>
        <textarea
          ref={ref}
          readOnly
          defaultValue={turn.text}
          onClick={update}
          onKeyUp={update}
          onSelect={update}
          rows={6}
          className="transcript-text w-full rounded-lg border bg-muted/40 p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Turn text: place the cursor where the split should happen"
        />
        {valid ? (
          <div className="space-y-1 text-sm">
            <p><span className="font-medium">First part:</span> “…{turn.text.slice(Math.max(0, at - 40), at).trim()}”</p>
            <p><span className="font-medium">Second part:</span> “{turn.text.slice(at, at + 40).trim()}…”</p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Place the cursor inside the text (not at the very start or end).</p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!valid || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onSplit(at);
                onOpenChange(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            Split here
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Replace listed names with [NAME] everywhere in the session (Privacy section). */
export function RedactDialog({ open, onOpenChange, onRedact }: Base & { onRedact: (names: string[]) => Promise<void> }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const names = value.split(/[,\n]/).map((n) => n.trim()).filter(Boolean);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Redact names</DialogTitle>
          <DialogDescription>
            Every listed name is replaced with [NAME] in the transcript, AI insights, summary and your notes. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="redact-names">Names to remove (separate with commas)</Label>
          <Input id="redact-names" value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. Priya, Rahul, Mrs Shah" />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!names.length || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onRedact(names);
                setValue("");
                onOpenChange(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            Redact {names.length ? `${names.length} name${names.length > 1 ? "s" : ""}` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Run the pipeline again, e.g. with stronger background-noise reduction. */
export function ReprocessDialog({
  open, onOpenChange, initial, hasTranscript, onReprocess,
}: Base & { initial: NoiseLevel; hasTranscript: boolean; onReprocess: (noise: NoiseLevel) => Promise<void> }) {
  const [noise, setNoise] = useState<NoiseLevel>(initial);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Re-process the recording</DialogTitle>
          <DialogDescription>
            Transcribe the original audio again. Useful if background noise hurt the transcript, or after adding your Hugging Face token.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="reprocess-noise">Background noise reduction</Label>
          <NativeSelect id="reprocess-noise" value={noise} onChange={(e) => setNoise(e.target.value as NoiseLevel)}>
            {NOISE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </NativeSelect>
        </div>
        {hasTranscript && (
          <p className="rounded-lg bg-risk/10 p-3 text-sm text-risk">
            This replaces the current transcript, including your edits, AI insights and notes.
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onReprocess(noise);
                onOpenChange(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            Re-process
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteDialog({ open, onOpenChange, title, onDelete }: Base & { title: string; onDelete: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this session?</DialogTitle>
          <DialogDescription>
            “{title}” — its audio, transcript, AI insights and your notes will be permanently removed from this computer.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Keep it</Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onDelete();
              } finally {
                setBusy(false);
              }
            }}
          >
            Delete everything
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
