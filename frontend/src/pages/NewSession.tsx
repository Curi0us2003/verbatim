import { useState } from "react";
import { Mic, UploadCloud } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import type { SessionMeta } from "@/types";
import { ProgressSteps } from "@/components/ProgressSteps";
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
  const [params, setParams] = useSearchParams();
  const mode = params.get("mode") === "upload" ? "upload" : "record";
  // One form shared by both tabs, so switching tabs keeps what was typed.
  const [meta, setMeta] = useState<SessionMeta>({
    title: "",
    client_code: "",
    language: "auto",
    date: today(),
    consent: false,
  });
  const ready = metaIsValid(meta);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New session</h1>
        <p className="mt-1 text-muted-foreground">Record live or upload a recording. Both get the same verbatim transcript.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Session details</CardTitle>
          <CardDescription>Use a client code, never a real name.</CardDescription>
        </CardHeader>
        <CardContent>
          <SessionDetailsForm value={meta} onChange={setMeta} />
        </CardContent>
      </Card>

      <Tabs value={mode} onValueChange={(v) => setParams({ mode: v }, { replace: true })}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="record">
            <Mic /> Record
          </TabsTrigger>
          <TabsTrigger value="upload">
            <UploadCloud /> Upload
          </TabsTrigger>
        </TabsList>

        <TabsContent value="record">
          <Card>
            <CardContent className="pt-6">
              <Recorder ready={ready} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="upload" className="space-y-6">
          <Card>
            <CardContent className="pt-6">
              <UploadZone ready={ready} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">What happens next</CardTitle>
            </CardHeader>
            <CardContent>
              <ProgressSteps current={null} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
