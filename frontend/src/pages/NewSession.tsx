import { useEffect, useState } from "react";
import { Mic, UploadCloud } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/api";
import type { SessionMeta } from "@/types";
import { Recorder } from "@/components/Recorder";
import { SessionDetailsForm, metaIsValid } from "@/components/SessionDetailsForm";
import { UploadZone } from "@/components/UploadZone";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function NewSessionPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const mode = params.get("mode") === "upload" ? "upload" : "record";
  // One form shared by both tabs, so switching tabs keeps what was typed.
  const [meta, setMeta] = useState<SessionMeta>({
    title: "",
    client_code: "",
    language: "auto",
    date: today(),
    consent: false,
    noise_reduction: "light",
  });
  useEffect(() => {
    api.getSettings().then((s) => setMeta((m) => ({ ...m, noise_reduction: s.noise_reduction })), () => undefined);
  }, []);
  const [recording, setRecording] = useState(false);
  const ready = metaIsValid(meta);
  const open = (id: number) => navigate(`/sessions/${id}`);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New session</h1>
        <p className="mt-1 text-muted-foreground">Record live or upload a recording. Both get the same verbatim transcript.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Session details</CardTitle>
          <CardDescription>
            {recording ? "Locked while recording." : "Use a client code, never a real name."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SessionDetailsForm value={meta} onChange={setMeta} disabled={recording} />
        </CardContent>
      </Card>

      <Tabs value={mode} onValueChange={(v) => setParams({ mode: v }, { replace: true })}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="record"><Mic /> Record</TabsTrigger>
          <TabsTrigger value="upload" disabled={recording}><UploadCloud /> Upload</TabsTrigger>
        </TabsList>

        <TabsContent value="record" forceMount className="data-[state=inactive]:hidden">
          <Card>
            <CardContent className="pt-6">
              <Recorder
                meta={meta}
                ready={ready}
                onSuggestNoise={(level) => setMeta((m) => ({ ...m, noise_reduction: level }))}
                onFinished={open}
                onActiveChange={setRecording}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="upload">
          <Card>
            <CardContent className="pt-6">
              <UploadZone meta={meta} ready={ready} onUploaded={open} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
