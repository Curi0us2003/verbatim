import { useRef, useState } from "react";
import { FileAudio, UploadCloud, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/api";
import type { SessionMeta } from "@/types";
import { ProgressSteps } from "@/components/ProgressSteps";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const ACCEPTED = [".mp3", ".wav", ".m4a", ".ogg", ".webm", ".mp4"];
const MAX_BYTES = 500 * 1024 * 1024; // 500 MB (F5)

function checkFile(file: File): string | null {
  const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  if (!ACCEPTED.includes(ext)) return `“${file.name}” isn't a supported audio file.`;
  if (file.size > MAX_BYTES) return `“${file.name}” is larger than 500 MB.`;
  return null;
}

/** Drag-and-drop upload (F5). After upload the review page shows the remaining stages. */
export function UploadZone({ meta, ready, onUploaded }: { meta: SessionMeta; ready: boolean; onUploaded: (id: number) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [percent, setPercent] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const uploading = percent !== null;

  const pick = (f: File | undefined) => {
    if (!f || uploading) return;
    const error = checkFile(f);
    if (error) toast.error(error, { description: `Accepted: ${ACCEPTED.join(", ")} — up to 500 MB.` });
    else setFile(f);
  };

  const start = async () => {
    if (!file) return;
    setPercent(0);
    try {
      const session = await api.upload(meta, file, setPercent);
      toast.success("Upload complete", { description: "Transcription has started." });
      onUploaded(session.id);
    } catch (e) {
      toast.error((e as Error).message);
      setPercent(null);
    }
  };

  if (uploading) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Please keep this tab open until the upload finishes.</p>
        <ProgressSteps current="uploading" percent={percent} showInsights={false} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), inputRef.current?.click())}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          pick(e.dataTransfer.files[0]);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          dragging ? "border-sage bg-sage/10" : "border-border hover:border-sage hover:bg-muted/50",
        )}
        aria-label="Choose an audio file to upload"
      >
        <UploadCloud className="h-10 w-10 text-sage" aria-hidden />
        <div>
          <p className="font-medium">Drop a recording here, or click to choose</p>
          <p className="text-sm text-muted-foreground">MP3, WAV, M4A, OGG, WEBM or MP4 — up to 500 MB</p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED.join(",") + ",audio/*"}
          className="hidden"
          onChange={(e) => {
            pick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>

      {file && (
        <div className="flex items-center gap-3 rounded-xl border bg-card p-3">
          <FileAudio className="h-5 w-5 text-sage" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{file.name}</p>
            <p className="text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
          </div>
          <Button variant="ghost" size="icon" onClick={() => setFile(null)} aria-label="Remove file">
            <X />
          </Button>
        </div>
      )}

      <Button size="lg" className="w-full" disabled={!ready || !file} onClick={start}>
        Upload and transcribe
      </Button>
      {!ready && (
        <p className="text-center text-sm text-muted-foreground">
          Fill in the title and client code, and tick the consent box to enable upload.
        </p>
      )}
    </div>
  );
}
