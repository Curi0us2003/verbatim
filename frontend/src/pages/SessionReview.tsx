import { useEffect, useState } from "react";
import { ArrowLeft, ArrowLeftRight, Info, Search, Sparkles } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/api";
import type { SessionDetail, SummaryData } from "@/types";
import { AudioBar } from "@/components/AudioBar";
import { TranscriptView } from "@/components/TranscriptView";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DEMO_SESSION } from "@/lib/placeholder";
import { formatDate, formatDuration, languageLabel } from "@/lib/utils";

export function SessionReviewPage() {
  const { id = "" } = useParams();
  const isDemo = id === "demo";
  const [session, setSession] = useState<SessionDetail | null>(isDemo ? DEMO_SESSION : null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (isDemo) return;
    api.getSession(id).then(setSession, (e: Error) => setError(e.message));
  }, [id, isDemo]);

  const player = useDemoClock(session?.duration_sec ?? 0);

  if (error) {
    return (
      <Card className="p-6">
        <p className="font-medium">{error}</p>
        <Link to="/" className="text-sm text-primary underline-offset-4 hover:underline">
          Back to sessions
        </Link>
      </Card>
    );
  }

  if (!session) return <ReviewSkeleton />;

  const matches = query.trim()
    ? session.turns.reduce((n, t) => n + countMatches(t.text, query.trim()), 0)
    : 0;
  const comingSoon = (what: string, phase: number) =>
    toast.info(`${what} arrives in Phase ${phase}`, { description: "This is placeholder data for now." });

  return (
    <div className="space-y-6 pb-24">
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden /> All sessions
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{session.title}</h1>
          <p className="mt-1 text-muted-foreground">
            {session.client_code} · {formatDate(session.created_at)} · {formatDuration(session.duration_sec)} ·{" "}
            {languageLabel(session.language)}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => comingSoon("Swap roles", 4)}>
            <ArrowLeftRight /> Swap roles
          </Button>
          <Button onClick={() => comingSoon("Generate insights", 6)}>
            <Sparkles /> Generate insights
          </Button>
        </div>
      </div>

      {isDemo && (
        <div className="flex items-start gap-2 rounded-xl border border-counsellor-border/40 bg-counsellor/60 p-3 text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-counsellor-ink" aria-hidden />
          <span>This is a fictional demo session with placeholder data. Nothing here is saved.</span>
        </div>
      )}

      <Tabs defaultValue="transcript">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="transcript">Transcript</TabsTrigger>
            <TabsTrigger value="summary">Session summary</TabsTrigger>
          </TabsList>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the transcript"
              className="pl-9"
              aria-label="Search the transcript"
            />
          </div>
        </div>
        {query.trim() && (
          <p className="mt-2 text-sm text-muted-foreground" role="status">
            {matches} {matches === 1 ? "match" : "matches"}
          </p>
        )}

        <TabsContent value="transcript">
          {session.turns.length === 0 ? (
            <Card className="p-6 text-muted-foreground">The transcript isn't ready yet.</Card>
          ) : (
            <TranscriptView
              turns={session.turns}
              exchanges={session.exchanges}
              time={player.time}
              query={query}
              onSeek={player.seek}
            />
          )}
        </TabsContent>

        <TabsContent value="summary">
          {session.summary ? (
            <SummaryView data={session.summary.summary_json} />
          ) : (
            <Card className="p-6 text-muted-foreground">
              No summary yet. Use <strong>Generate insights</strong> to create one.
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <AudioBar
        time={player.time}
        duration={session.duration_sec ?? 0}
        playing={player.playing}
        onTogglePlay={player.toggle}
        onSeek={player.seek}
        note={isDemo ? "Demo: no real audio" : undefined}
      />
    </div>
  );
}

function SummaryView({ data }: { data: SummaryData }) {
  const sections: [string, string[]][] = [
    ["Main themes", data.main_themes],
    ["Client's stated goals", data.client_goals],
    ["Key concerns", data.key_concerns],
    ["Emotional shifts", data.emotional_shifts],
    ["Strengths noticed", data.strengths_noticed],
    ["Topics for next session", data.topics_for_next_session],
  ];
  return (
    <div className="space-y-4">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5" aria-hidden /> AI interpretation — not a clinical judgement
      </p>
      {data.risk_flags.length > 0 && (
        <div role="alert" className="rounded-xl bg-risk/10 p-4 text-risk">
          <p className="font-medium">Possible risk mentioned</p>
          <ul className="mt-1 list-disc pl-5 text-sm">
            {data.risk_flags.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Overview</CardTitle>
        </CardHeader>
        <CardContent className="leading-relaxed">{data.overview}</CardContent>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        {sections.map(([title, items]) => (
          <Card key={title}>
            <CardHeader>
              <CardTitle className="text-base">{title}</CardTitle>
            </CardHeader>
            <CardContent>
              {items.length ? (
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  {items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
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

function countMatches(text: string, q: string): number {
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  let n = 0;
  for (let i = lower.indexOf(needle); i !== -1; i = lower.indexOf(needle, i + needle.length)) n++;
  return n;
}

/** Stand-in playback clock so the highlight can be tried without audio. Replaced by <audio> in Phase 4. */
function useDemoClock(duration: number) {
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      setTime((t) => {
        if (t + 0.25 >= duration) {
          setPlaying(false);
          return duration;
        }
        return t + 0.25;
      });
    }, 250);
    return () => clearInterval(timer);
  }, [playing, duration]);

  return {
    time,
    playing,
    toggle: () => setPlaying((p) => !p),
    seek: (s: number) => setTime(Math.min(Math.max(0, s), duration)),
  };
}
