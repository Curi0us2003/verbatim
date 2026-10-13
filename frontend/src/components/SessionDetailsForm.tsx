import { Link } from "react-router-dom";
import type { NoiseLevel, SessionMeta } from "@/types";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/select";
import { LANGUAGES, NOISE_OPTIONS } from "@/lib/utils";

export const CLIENT_CODE_PATTERN = /^[A-Za-z]{1,4}-?\d{1,5}$/;

/** Metadata + consent shared by the Record and Upload tabs (F2, F5). */
export function SessionDetailsForm({ value, onChange, disabled }: { value: SessionMeta; onChange: (v: SessionMeta) => void; disabled?: boolean }) {
  const set = <K extends keyof SessionMeta>(key: K, v: SessionMeta[K]) => onChange({ ...value, [key]: v });
  const codeInvalid = value.client_code !== "" && !CLIENT_CODE_PATTERN.test(value.client_code);

  return (
    <fieldset className="space-y-5" disabled={disabled}>
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="title">Session title</Label>
          <Input id="title" value={value.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Session 3 — follow-up" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="client-code">Client code</Label>
          <Input
            id="client-code"
            value={value.client_code}
            onChange={(e) => set("client_code", e.target.value.toUpperCase())}
            placeholder="C-014"
            aria-invalid={codeInvalid}
            aria-describedby="client-code-hint"
            className={codeInvalid ? "border-risk focus-visible:ring-risk" : undefined}
          />
          <p id="client-code-hint" className={codeInvalid ? "text-xs text-risk" : "text-xs text-muted-foreground"}>
            {codeInvalid ? "Use a code like C-014." : "A pseudonym — never the client's real name."}
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="language">Language</Label>
          <NativeSelect id="language" value={value.language} onChange={(e) => set("language", e.target.value)} aria-describedby="language-hint">
            {LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>{l.label}</option>
            ))}
          </NativeSelect>
          <p id="language-hint" className="text-xs text-muted-foreground">Pick the main language if the session mixes languages.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="date">Date</Label>
          <Input id="date" type="date" value={value.date} onChange={(e) => set("date", e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="noise">Background noise</Label>
          <NativeSelect id="noise" value={value.noise_reduction} onChange={(e) => set("noise_reduction", e.target.value as NoiseLevel)}>
            {NOISE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </NativeSelect>
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-sage/40 bg-sage/5 p-4">
        <Checkbox id="consent" checked={value.consent} onCheckedChange={(c) => set("consent", c === true)} className="mt-0.5" />
        <Label htmlFor="consent" className="text-sm font-normal leading-relaxed">
          The client has given informed consent to record this session.
          <span className="block text-xs text-muted-foreground">
            Required before recording or uploading. Need a form?{" "}
            <Link to="/consent-form" target="_blank" className="text-primary underline underline-offset-2">
              Printable consent form
            </Link>
          </span>
        </Label>
      </div>
    </fieldset>
  );
}

/** True when the form is complete enough to start recording or uploading. */
export function metaIsValid(m: SessionMeta): boolean {
  return m.consent && m.title.trim() !== "" && CLIENT_CODE_PATTERN.test(m.client_code);
}
