import type { SessionMeta } from "@/types";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LANGUAGES } from "@/lib/utils";

export const CLIENT_CODE_PATTERN = /^[A-Za-z]{1,4}-?\d{1,5}$/;

/** Metadata + consent shared by the Record and Upload tabs (F2, F5). */
export function SessionDetailsForm({ value, onChange }: { value: SessionMeta; onChange: (v: SessionMeta) => void }) {
  const set = <K extends keyof SessionMeta>(key: K, v: SessionMeta[K]) => onChange({ ...value, [key]: v });
  const codeInvalid = value.client_code !== "" && !CLIENT_CODE_PATTERN.test(value.client_code);

  return (
    <div className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="title">Session title</Label>
          <Input
            id="title"
            value={value.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="e.g. Session 3 — follow-up"
          />
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
          <select
            id="language"
            value={value.language}
            onChange={(e) => set("language", e.target.value)}
            className="flex h-10 w-full rounded-lg border border-input bg-card px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="date">Date</Label>
          <Input id="date" type="date" value={value.date} onChange={(e) => set("date", e.target.value)} />
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-sage/40 bg-sage/5 p-4">
        <Checkbox
          id="consent"
          checked={value.consent}
          onCheckedChange={(c) => set("consent", c === true)}
          className="mt-0.5"
        />
        <Label htmlFor="consent" className="text-sm font-normal leading-relaxed">
          The client has given informed consent to record this session.
          <span className="block text-xs text-muted-foreground">Required before recording or uploading.</span>
        </Label>
      </div>
    </div>
  );
}

/** True when the form is complete enough to start recording or uploading. */
export function metaIsValid(m: SessionMeta): boolean {
  return m.consent && m.title.trim() !== "" && CLIENT_CODE_PATTERN.test(m.client_code);
}
