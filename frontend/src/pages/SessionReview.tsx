import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowLeftRight,
  ChevronDown,
  ChevronUp,
  Download,
  EyeOff,
  FileText,
  MoreHorizontal,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/api";
import { isInsight, type Exchange, type SessionDetail, type SessionStatus, type StatusInfo, type SummaryData, type Turn } from "@/types";
import { AudioBar } from "@/components/AudioBar";
import { ProgressSteps } from "@/components/ProgressSteps";
import { DeleteDialog, RedactDialog, ReprocessDialog, SplitDialog } from "@/components/SessionDialogs";
import { TranscriptView } from "@/components/TranscriptView";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAudio } from "@/hooks/useAudio";
import { formatDate, formatDuration, languageLabel } from "@/lib/utils";

const PROCESSING: SessionStatus[] = ["converting", "transcribing", "diarizing"];

export function SessionReviewPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<StatusInfo | null>(null);
  const [query, setQuery] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [dialog, setDialog] = useState<null | "redact" | "reprocess" | "delete">(null);
  const [splitTurn, setSplitTurn] = useState<Turn | null>(null);

  const load = useCallback(
    () => api.getSession(id).then((s) => (setSession(s), setError(null)), (e: Error) => setError(e.message)),
    [id],
  );
  useEffect(() => {
    void load();
  }, [load]);

  // Poll while the pipeline or the AI is working (SPEC: every 2 s).
  const status = session?.status;
  const working = !!status && (PROCESSING.includes(status) || status === "insights");
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(async () => {
      try {
        const st = await api.status(id);
        setProgress(st);
        if (st.status !== status || st.status === "insights") void load();
      } catch {
        /* keep polling */
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [working, id, status, load]);

  const audioSrc = session && session.has_audio && !PROCESSING.includes(session.status) ? api.audioUrl(session.id) : null;
  const player = useAudio(audioSrc);

  const turns = useMemo(() => session?.turns ?? [], [session]);
  const activeTurnId = useMemo(() => {
    if (!player.time && !player.playing) return null;
    return turns.find((t) => player.time >= t.start && player.time <= t.end + 0.3)?.id ?? null;
  }, [turns, player.time, player.playing]);

  // Keep the turn being played in view.
  useEffect(() => {
    if (activeTurnId && player.playing) {
      document.querySelector(`[data-turn-id="${activeTurnId}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [activeTurnId, player.playing]);

  // Search across the transcript.
  const q = query.trim().toLowerCase();
  const matches = useMemo(() => (q ? turns.filter((t) => t.text.toLowerCase().includes(q)) : []), [turns, q]);
  useEffect(() => setMatchIndex(0), [q]);
  const goToMatch = (index: number) => {
    if (!matches.length) return;
    const i = (index + matches.length) % matches.length;
    setMatchIndex(i);
    document.querySelector(`[data-turn-id="${matches[i].id}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  // Keyboard shortcuts: Space play/pause, J/L back/forward 5 s, E edit current turn.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable='true'], [role='dialog'], [role='menu']")) return;
      const key = e.key.toLowerCase();
      if (key === " ") {
        // Space plays/pauses inside the transcript and player; elsewhere it presses the focused button as usual.
        if (target.closest("button, a, [role='button']") && !target.closest("[data-turn-id], [data-audio-bar]")) return;
        e.preventDefault();
        player.toggle();
      } else if (key === "j") player.skip(-5);
      else if (key === "l") player.skip(5);
      else if (key === "e" && turns.length) {
        e.preventDefault();
        setEditingId(activeTurnId ?? turns[0].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [player, turns, activeTurnId]);

  if (error) {
    return (
      <Card className="space-y-2 p-6">
        <p className="font-medium">{error}</p>
        <Link to="/" className="text-sm text-primary underline-offset-4 hover:underline">Back to sessions</Link>
      </Card>
    );
  }
  if (!session) return <ReviewSkeleton />;

  const run = async <T,>(action: () => Promise<T>, done?: (result: T) => void) => {
    try {
      const result = await action();
      done?.(result);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const updateExchange = (ex: Exchange) =>
    setSession((s) => s && { ...s, exchanges: s.exchanges.map((e) => (e.id === ex.id ? ex : e)) });

  const generateInsights = async () => {
    const llm = await api.llmHealth().catch(() => null);
    if (llm && !llm.ready) {
      toast.error("The AI model is not ready", { description: llm.detail ?? undefined, duration: 10000 });
      return;
    }
    await run(() => api.generateInsights(session.id), (s) => {
      setSession((prev) => prev && { ...prev, status: s.status });
      toast.info("Generating insights…", { description: "Cards fill in as each exchange is read." });
    });
  };

  const header = (
    <>
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground print:hidden">
        <ArrowLeft className="h-4 w-4" aria-hidden /> All sessions
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{session.title}</h1>
          <p className="mt-1 text-muted-foreground">
            {[
              session.client_code,
              formatDate(session.created_at),
              session.duration_sec != null && formatDuration(session.duration_sec),
              languageLabel(session.detected_language ?? session.language),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        {(session.status === "ready" || session.status === "insights") && (
          <div className="flex flex-wrap gap-2 print:hidden">
            <Button variant="outline" onClick={() => run(() => api.swapRoles(session.id), (s) => (setSession(s), toast.success("Counsellor and client swapped")))} disabled={session.status === "insights"}>
              <ArrowLeftRight /> Swap roles
            </Button>
            <Button onClick={generateInsights} disabled={session.status === "insights"}>
              <Sparkles /> {session.status === "insights" ? "Generating…" : session.summary ? "Regenerate insights" : "Generate insights"}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline"><Download /> Export <ChevronDown /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Verbatim + insights</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => window.open(api.exportUrl(session.id, "pdf"), "_blank")}>
                  <FileText /> PDF (print)
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a href={api.exportUrl(session.id, "docx")} download><FileText /> Word (.docx)</a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a href={api.exportUrl(session.id, "txt")} download><FileText /> Plain text (.txt)</a>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <SessionMenu onSelect={setDialog} canReprocess={!session.audio_deleted_at} disabled={session.status === "insights"} />
          </div>
        )}
      </div>
    </>
  );

  const dialogs = (
    <>
      <RedactDialog
        open={dialog === "redact"}
        onOpenChange={(o) => setDialog(o ? "redact" : null)}
        onRedact={(names) => run(() => api.redact(session.id, names), (r) => (setSession(r.session), toast.success(`Replaced ${r.replaced} mention${r.replaced === 1 ? "" : "s"} with [NAME]`)))}
      />
      <ReprocessDialog
        key={session.noise_reduction}
        open={dialog === "reprocess"}
        onOpenChange={(o) => setDialog(o ? "reprocess" : null)}
        initial={session.noise_reduction}
        hasTranscript={turns.length > 0}
        onReprocess={(noise) => run(() => api.reprocess(session.id, noise), () => (setProgress(null), void load()))}
      />
      <DeleteDialog
        open={dialog === "delete"}
        onOpenChange={(o) => setDialog(o ? "delete" : null)}
        title={session.title}
        onDelete={() => run(() => api.deleteSession(session.id), () => (toast.success("Session deleted"), navigate("/")))}
      />
    </>
  );

  // ---- Not ready yet -------------------------------------------------------
  if (session.status === "uploading") {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        {header}
        <Card>
          <CardHeader><CardTitle>This recording was not finished</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground">
              The browser may have closed while recording. Everything saved up to the last 30-second chunk can still be processed.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => run(() => api.finish(session.id), () => void load())}>Process what was saved</Button>
              <Button variant="ghost" onClick={() => setDialog("delete")}><Trash2 /> Delete</Button>
            </div>
          </CardContent>
        </Card>
        {dialogs}
      </div>
    );
  }
  if (PROCESSING.includes(session.status)) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        {header}
        <Card>
          <CardHeader><CardTitle>Preparing the transcript</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <ProgressSteps current={session.status} percent={progress?.status === session.status ? progress.percent : undefined} showInsights={false} />
            <p className="text-sm text-muted-foreground">
              You can leave this page — processing continues in the background. A 50-minute session takes a few minutes on a GPU,
              longer on a laptop CPU.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }
  if (session.status === "failed") {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        {header}
        <Card className="border-risk/50">
          <CardHeader><CardTitle>Processing did not finish</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p role="alert" className="rounded-lg bg-risk/10 p-3 text-sm text-risk">{session.error}</p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setDialog("reprocess")}><RefreshCw /> Re-process</Button>
              <Button variant="ghost" onClick={() => setDialog("delete")}><Trash2 /> Delete</Button>
            </div>
          </CardContent>
        </Card>
        {dialogs}
      </div>
    );
  }

  // ---- Review --------------------------------------------------------------
  const riskyExchanges = session.exchanges.filter((e) => isInsight(e.insight_json) && e.insight_json.risk_flag);
  const summaryRisks = session.summary?.summary_json.risk_flags ?? [];
  const generating = session.status === "insights";

  return (
    <div className="space-y-6 pb-24">
      {header}

      {(riskyExchanges.length > 0 || summaryRisks.length > 0) && (
        <div role="alert" className="flex flex-wrap items-start gap-3 rounded-xl border border-risk/40 bg-risk/10 p-4 text-risk">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Possible risk mentioned{riskyExchanges.length ? ` in ${riskyExchanges.length} exchange${riskyExchanges.length > 1 ? "s" : ""}` : ""}</p>
            <p className="text-sm">The AI flagged self-harm, abuse or harm to others. Please review these parts yourself — this never replaces your own judgement.</p>
          </div>
          {riskyExchanges.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => document.getElementById(`exchange-${riskyExchanges[0].id}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}>
              Go to first
            </Button>
          )}
        </div>
      )}

      {session.warning && (
        <div role="status" className="flex items-start gap-2 rounded-xl border border-client-border/50 bg-client p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-client-ink" aria-hidden />
          <span>{session.warning}</span>
        </div>
      )}

      <Tabs defaultValue="transcript">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="transcript">Transcript</TabsTrigger>
            <TabsTrigger value="summary">Session summary</TabsTrigger>
          </TabsList>
          <div className="flex w-full items-center gap-1 sm:w-auto">
            <div className="relative flex-1 sm:w-72">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && goToMatch(matchIndex + (e.shiftKey ? -1 : 1))}
                placeholder="Search the transcript"
                className="pl-9"
                aria-label="Search the transcript"
              />
            </div>
            {q && (
              <>
                <span className="w-20 text-center text-xs text-muted-foreground" role="status">
                  {matches.length ? `${matchIndex + 1} of ${matches.length}` : "No matches"}
                </span>
                <Button variant="ghost" size="icon" onClick={() => goToMatch(matchIndex - 1)} disabled={!matches.length} aria-label="Previous match"><ChevronUp /></Button>
                <Button variant="ghost" size="icon" onClick={() => goToMatch(matchIndex + 1)} disabled={!matches.length} aria-label="Next match"><ChevronDown /></Button>
              </>
            )}
          </div>
        </div>

        <TabsContent value="transcript">
          {turns.length === 0 ? (
            <Card className="p-6 text-muted-foreground">No speech was found in this recording.</Card>
          ) : (
            <TranscriptView
              turns={turns}
              exchanges={session.exchanges}
              activeTurnId={activeTurnId}
              editingTurnId={editingId}
              query={query}
              generating={generating}
              onSeek={(t) => player.seek(t, true)}
              onEdit={setEditingId}
              onSaveText={(turn, text) =>
                run(() => api.updateTurn(turn.id, { text }), (s) => (setSession(s), setEditingId(null), toast.success("Saved")))
              }
              onToggleRole={(turn) => {
                const role = turn.role === "counsellor" ? "client" : "counsellor";
                void run(() => api.updateTurn(turn.id, { role }), (s) => (setSession(s), toast.success(`Marked as ${role}`)));
              }}
              onSplit={setSplitTurn}
              onExchangeChange={updateExchange}
            />
          )}
        </TabsContent>

        <TabsContent value="summary">
          {session.summary ? (
            <SummaryView data={session.summary.summary_json} model={session.summary.model_used} />
          ) : generating ? (
            <Card className="space-y-3 p-6" aria-busy="true">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </Card>
          ) : (
            <Card className="p-6 text-muted-foreground">
              No summary yet. Use <strong>Generate insights</strong> to create one.
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <AudioBar
        audioRef={player.ref}
        src={audioSrc}
        time={player.time}
        duration={player.duration || session.duration_sec || 0}
        playing={player.playing}
        onTogglePlay={player.toggle}
        onSeek={(t) => player.seek(t)}
        onSkip={player.skip}
        unavailableReason={
          session.audio_deleted_at
            ? `Audio removed on ${formatDate(session.audio_deleted_at)} by your retention setting. The transcript is kept.`
            : undefined
        }
      />

      <SplitDialog
        key={splitTurn?.id}
        open={!!splitTurn}
        onOpenChange={(o) => !o && setSplitTurn(null)}
        turn={splitTurn}
        onSplit={(at) => run(() => api.splitTurn(splitTurn!.id, at), (s) => (setSession(s), toast.success("Turn split")))}
      />
      {dialogs}
    </div>
  );
}

function SessionMenu({ onSelect, canReprocess, disabled }: { onSelect: (d: "redact" | "reprocess" | "delete") => void; canReprocess: boolean; disabled: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" aria-label="More actions" disabled={disabled}><MoreHorizontal /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onSelect("redact")}><EyeOff /> Redact names…</DropdownMenuItem>
        {canReprocess && <DropdownMenuItem onSelect={() => onSelect("reprocess")}><RefreshCw /> Re-process audio…</DropdownMenuItem>}
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={() => onSelect("delete")}><Trash2 /> Delete session…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SummaryView({ data, model }: { data: SummaryData; model: string }) {
  const sections: [string, string[]][] = [
    ["Main themes", data.main_themes],
    ["Client's stated goals", data.client_goals],
    ["Key concerns", data.key_concerns],
    ["Notable emotional shifts", data.emotional_shifts],
    ["Strengths noticed", data.strengths_noticed],
    ["Topics for next session", data.topics_for_next_session],
  ];
  return (
    <div className="space-y-4">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5" aria-hidden /> AI interpretation — not a clinical judgement · {model}
      </p>
      {data.risk_flags.length > 0 && (
        <div role="alert" className="rounded-xl bg-risk/10 p-4 text-risk">
          <p className="font-medium">Possible risk mentioned</p>
          <ul className="mt-1 list-disc pl-5 text-sm">
            {data.risk_flags.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>
      )}
      <Card>
        <CardHeader><CardTitle className="text-base">Overview</CardTitle></CardHeader>
        <CardContent className="leading-relaxed">{data.overview}</CardContent>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        {sections.map(([title, items]) => (
          <Card key={title}>
            <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
            <CardContent>
              {items.length ? (
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  {items.map((item, i) => <li key={i}>{item}</li>)}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">Nothing noted.</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function ReviewSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading session">
      <Skeleton className="h-8 w-72" />
      <Skeleton className="h-4 w-48" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="grid gap-8 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <Skeleton className="h-24 w-4/5 rounded-2xl" />
            <Skeleton className="ml-auto h-32 w-4/5 rounded-2xl" />
          </div>
          <Skeleton className="hidden h-48 rounded-xl lg:block" />
        </div>
      ))}
    </div>
  );
}
