import { useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, FileSignature, XCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/api";
import type { AppSettings, Health, NoiseLevel } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { VoiceEnrollCard } from "@/components/VoiceEnrollCard";
import { NOISE_OPTIONS } from "@/lib/utils";

export function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [retention, setRetention] = useState("0");
  const [health, setHealth] = useState<Health | null>(null);
  const [llm, setLlm] = useState<{ ready: boolean; detail: string | null } | null>(null);

  useEffect(() => {
    api.getSettings().then((s) => (setSettings(s), setRetention(String(s.retention_days))), (e: Error) => toast.error(e.message));
    api.health().then(setHealth, () => undefined);
    api.llmHealth().then(setLlm, () => undefined);
  }, []);

  const save = async (changes: Partial<AppSettings>, message: string) => {
    try {
      setSettings(await api.saveSettings(changes));
      toast.success(message);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-muted-foreground">Privacy, AI and recording preferences for this computer.</p>
      </div>

      {!settings ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Recordings and privacy</CardTitle>
              <CardDescription>Audio is stored only on this computer{health?.checks.encryption ? ", encrypted" : ""}.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <form
                className="space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void save({ retention_days: Math.max(0, Number(retention) || 0) }, "Retention setting saved");
                }}
              >
                <Label htmlFor="retention">Delete audio automatically after (days)</Label>
                <div className="flex gap-2">
                  <Input id="retention" type="number" min={0} max={3650} value={retention} onChange={(e) => setRetention(e.target.value)} className="w-32" aria-describedby="retention-hint" />
                  <Button type="submit" variant="outline" disabled={String(settings.retention_days) === retention}>Save</Button>
                </div>
                <p id="retention-hint" className="text-sm text-muted-foreground">
                  0 keeps audio until you delete the session. Transcripts, edits and notes are always kept. Checked hourly.
                </p>
              </form>
              <div className="space-y-2">
                <Label htmlFor="noise-default">Default background noise reduction</Label>
                <NativeSelect
                  id="noise-default"
                  value={settings.noise_reduction}
                  onChange={(e) => void save({ noise_reduction: e.target.value as NoiseLevel }, "Default saved")}
                  className="max-w-md"
                >
                  {NOISE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </NativeSelect>
                <p className="text-sm text-muted-foreground">Used for new sessions; each session can still choose its own.</p>
              </div>
              <Link to="/consent-form" className="inline-flex items-center gap-2 text-sm text-primary underline-offset-4 hover:underline">
                <FileSignature className="h-4 w-4" aria-hidden /> Printable client consent form
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>AI understanding</CardTitle>
              <CardDescription>Insights are interpretations to support your reflection, never a clinical judgement.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-start gap-3">
                <Checkbox
                  id="auto-insights"
                  checked={settings.auto_insights}
                  onCheckedChange={(c) => void save({ auto_insights: c === true }, c ? "Insights will be generated automatically" : "Insights only on request")}
                  className="mt-0.5"
                />
                <Label htmlFor="auto-insights" className="font-normal leading-relaxed">
                  Generate insights automatically after transcription
                  <span className="block text-sm text-muted-foreground">Otherwise use the “Generate insights” button on each session.</span>
                </Label>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      <VoiceEnrollCard />

      <PasswordCard />

      <Card>
        <CardHeader>
          <CardTitle>System check</CardTitle>
          <CardDescription>What this computer is ready to do. Engines are changed in the .env file.</CardDescription>
        </CardHeader>
        <CardContent>
          {!health ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <ul className="space-y-2 text-sm">
              <Check ok={health.checks.ffmpeg} label="Audio conversion (ffmpeg)" />
              <Check
                ok={health.transcribe_engine === "groq" || health.checks.whisperx}
                label={health.transcribe_engine === "groq" ? "Transcription: Groq cloud" : `Transcription: WhisperX ${health.checks.whisper_model} (local)`}
                fix="Run npm run setup to install the speech models."
              />
              <Check ok={health.checks.hf_token} label="Speaker separation (Hugging Face token)" fix="Add HF_TOKEN to .env — see README, step 4. Voice analysis still separates speakers without it." />
              <Check ok={health.checks.voice_check} label="Voice analysis (second check of who said what)" fix="Set VOICE_CHECK=true in .env." />
              <Check
                ok={!!llm?.ready}
                label={`AI insights: ${health.checks.llm_model} (${health.llm_engine === "groq" ? "Groq cloud" : "Ollama, local"})`}
                fix={llm?.detail ?? "Checking…"}
              />
              <Check ok={health.checks.encryption} label="Audio encrypted at rest" fix="Add ENCRYPTION_KEY to .env (npm run setup creates one)." />
              <Check ok={!health.cloud_mode} label={health.cloud_mode ? "Cloud mode is ON — data leaves this computer" : "Local mode — data stays on this computer"} />
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Check({ ok, label, fix }: { ok: boolean; label: string; fix?: string }) {
  return (
    <li className="flex items-start gap-2">
      {ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-label="Ready" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-risk" aria-label="Not ready" />}
      <span>
        {label}
        {!ok && fix && <span className="block text-muted-foreground">{fix}</span>}
      </span>
    </li>
  );
}

function PasswordCard() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.changePassword(current, next);
      toast.success("Password changed");
      setCurrent("");
      setNext("");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>App password</CardTitle>
        <CardDescription>Locks the app on this computer. Use the lock button at the top when you step away.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div className="space-y-2">
            <Label htmlFor="current-password">Current password</Label>
            <Input id="current-password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-password">New password (8+ characters)</Label>
            <Input id="new-password" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          </div>
          <Button type="submit" variant="outline" disabled={busy || !current || next.length < 8}>Change</Button>
        </form>
      </CardContent>
    </Card>
  );
}
