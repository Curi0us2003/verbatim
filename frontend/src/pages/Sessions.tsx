import { useEffect, useRef, useState } from "react";
import { ChevronRight, Mic, UploadCloud, WifiOff } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "@/api";
import type { SessionRecord, SessionStatus } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, formatDuration } from "@/lib/utils";

const STATUS_LABEL: Record<SessionStatus, string> = {
  uploading: "Recording not finished",
  converting: "Converting",
  transcribing: "Transcribing",
  diarizing: "Identifying speakers",
  ready: "Ready",
  insights: "Generating insights",
  failed: "Needs attention",
};
const WORKING: SessionStatus[] = ["converting", "transcribing", "diarizing", "insights"];

export function SessionsPage() {
  const [sessions, setSessions] = useState<SessionRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const latest = useRef<SessionRecord[] | null>(null);

  useEffect(() => {
    const load = () =>
      api.listSessions().then(
        (s) => {
          latest.current = s;
          setSessions(s);
          setError(null);
        },
        (e: Error) => setError(e.message),
      );
    void load();
    // Refresh while anything is processing, so badges move on by themselves.
    const timer = setInterval(() => {
      if (latest.current?.some((s) => WORKING.includes(s.status))) void load();
    }, 3000);
    return () => clearInterval(timer);
  }, []);

  const f = filter.trim().toLowerCase();
  const shown = sessions?.filter((s) => !f || s.title.toLowerCase().includes(f) || s.client_code.toLowerCase().includes(f));

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sessions</h1>
          <p className="mt-1 text-muted-foreground">Your recorded and uploaded counselling sessions.</p>
        </div>
        {sessions && sessions.length > 3 && (
          <Input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by title or client code"
            className="w-full sm:w-72"
            aria-label="Filter sessions"
          />
        )}
      </div>

      {error && (
        <Card className="flex items-start gap-3 border-risk/40 p-5">
          <WifiOff className="mt-0.5 h-5 w-5 shrink-0 text-risk" aria-hidden />
          <div>
            <p className="font-medium">{error}</p>
            <p className="text-sm text-muted-foreground">
              Start both servers with <code className="rounded bg-muted px-1">npm run dev</code> in the project folder.
            </p>
          </div>
        </Card>
      )}

      {!error && sessions === null && (
        <div className="space-y-3" aria-busy="true" aria-label="Loading sessions">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
        </div>
      )}

      {sessions !== null && sessions.length === 0 && <EmptyState />}

      {shown && shown.length > 0 && (
        <ul className="space-y-3">
          {shown.map((s) => (
            <li key={s.id}>
              <Link to={`/sessions/${s.id}`} className="group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Card className="flex items-center gap-4 p-5 transition-colors group-hover:bg-muted/40">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{s.title}</p>
                    <p className="text-sm text-muted-foreground">
                      {s.client_code} · {formatDate(s.created_at)} · {formatDuration(s.duration_sec)}
                    </p>
                  </div>
                  <Badge
                    variant={s.status === "failed" ? "risk" : s.status === "ready" ? "default" : "secondary"}
                    className={WORKING.includes(s.status) ? "animate-pulse" : undefined}
                  >
                    {STATUS_LABEL[s.status]}
                  </Badge>
                  <ChevronRight className="h-5 w-5 text-muted-foreground" aria-hidden />
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {shown && sessions && sessions.length > 0 && shown.length === 0 && (
        <p className="text-muted-foreground">No sessions match “{filter}”.</p>
      )}
    </div>
  );
}

function EmptyState() {
  const cards = [
    { to: "/new?mode=record", icon: Mic, title: "Record a session", text: "Record live in the browser, with consent." },
    { to: "/new?mode=upload", icon: UploadCloud, title: "Upload a recording", text: "Use an audio file you already have." },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {cards.map(({ to, icon: Icon, title, text }) => (
        <Link key={to} to={to} className="group rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Card className="flex h-full flex-col items-center gap-4 p-10 text-center transition-colors group-hover:border-sage group-hover:bg-sage/5">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-sage/15 text-primary">
              <Icon className="h-8 w-8" aria-hidden />
            </span>
            <div>
              <p className="text-lg font-semibold">{title}</p>
              <p className="text-sm text-muted-foreground">{text}</p>
            </div>
          </Card>
        </Link>
      ))}
    </div>
  );
}
