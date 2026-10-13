import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Printable consent form template (Privacy section). Adapt it to your institution's rules. */
export function ConsentFormPage() {
  const line = <span className="inline-block min-w-[14rem] border-b border-foreground/60">&nbsp;</span>;
  return (
    <article className="mx-auto max-w-2xl space-y-5 leading-relaxed print:max-w-none print:text-[12pt]">
      <div className="flex items-center justify-between gap-4 print:hidden">
        <p className="text-sm text-muted-foreground">A template to adapt to your institution's ethics and supervision rules.</p>
        <Button onClick={() => window.print()}><Printer /> Print</Button>
      </div>

      <h1 className="text-2xl font-semibold">Consent to audio recording and AI-assisted notes</h1>
      <p>Client code: {line} &nbsp; Date: {line}</p>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">What will be recorded</h2>
        <p>
          With your permission, your counselling session will be audio recorded. The recording is used only to help your counsellor
          write accurate notes and reflect on the session. You are identified only by a client code, never by your name.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">How the recording is processed</h2>
        <ul className="list-disc space-y-1 pl-6">
          <li>Software on your counsellor's own computer turns the recording into a written, word-for-word transcript.</li>
          <li>
            An AI program suggests what you may have meant in each part of the conversation. These suggestions are only an aid for your
            counsellor's reflection. They are not a diagnosis and do not replace your counsellor's professional judgement.
          </li>
          <li>
            By default all processing happens on your counsellor's computer and is not sent to outside services. If an outside
            (cloud) service is ever used, your counsellor will tell you and ask for your separate agreement: {line}
          </li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Storage and deletion</h2>
        <ul className="list-disc space-y-1 pl-6">
          <li>The audio is stored in encrypted form on a password-protected computer.</li>
          <li>The audio will be deleted after {line} days. The written notes are kept as part of your counselling record.</li>
          <li>You can ask for the recording, transcript and notes to be deleted at any time.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Your choices</h2>
        <p>
          Saying no will not affect your counselling in any way. You can withdraw consent at any point, including during the session,
          and the recording will stop.
        </p>
        <p>This consent follows the Digital Personal Data Protection Act, 2023 and the rules of {line}.</p>
      </section>

      <section className="space-y-6 pt-4">
        <p>☐ I agree to my session being audio recorded and processed as described above.</p>
        <p>☐ I understand that AI suggestions are interpretations, not a diagnosis.</p>
        <div className="grid gap-8 pt-6 sm:grid-cols-2 print:grid-cols-2">
          <p>Client signature: {line}</p>
          <p>Counsellor signature: {line}</p>
        </div>
      </section>
    </article>
  );
}
