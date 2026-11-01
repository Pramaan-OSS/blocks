"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/pramaan/confirm-action";
import { StatusPill, type PillTone } from "@/components/pramaan/parts";
import { EmptyState, ErrorState, LoadingState, StatusMessage } from "@/components/pramaan/states";
import { ApiError, announceChange, api, useResource } from "@/lib/pramaan/client";
import { formatBytes, formatDate } from "@/lib/pramaan/plain";
import type { StoredFile, UploadLink } from "@/lib/pramaan/upload";

const NAMES = "pramaan-upload-names";
/** The API keeps no file names, so this browser remembers the ones it uploaded. */
const names = (): Record<string, string> => {
  try {
    return JSON.parse(sessionStorage.getItem(NAMES) ?? "{}");
  } catch {
    return {};
  }
};
const remember = (fileId: string, name: string) => sessionStorage.setItem(NAMES, JSON.stringify({ ...names(), [fileId]: name }));

const KIND: Record<string, string> = { image: "Image", audio: "Audio", video: "Video", document: "PDF document", data: "Data file" };

/** Sends the bytes to the storage link. XMLHttpRequest, because fetch can't report upload progress. */
function sendBytes(link: UploadLink, file: File, onProgress: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("PUT", link.uploadUrl);
    for (const [k, v] of Object.entries(link.headers)) if (k.toLowerCase() !== "content-length") x.setRequestHeader(k, v);
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    x.onload = () => (x.status >= 200 && x.status < 300 ? resolve() : reject(new Error("refused")));
    x.onerror = () => reject(new Error("network"));
    x.send(file);
  });
}

type Step = "uploading" | "checking" | "done" | "failed";
interface Item { key: number; file: File; step: Step; percent: number; message?: string }

const STEP: Record<Step, { text: string; tone: PillTone }> = {
  uploading: { text: "Uploading", tone: "blue" },
  checking: { text: "Checking", tone: "blue" },
  done: { text: "Uploaded", tone: "green" },
  failed: { text: "Didn't upload", tone: "red" },
};

export interface UploadedItem {
  readonly fileId: string;
  readonly filename: string;
  readonly contentType: string;
  readonly sizeBytes: number;
}

/**
 * Drag files here or choose them. Each file goes straight to storage with its own progress bar,
 * then is checked. `onUploaded` gets the file id to use elsewhere, for example in the e-sign block.
 */
export function UploadDropzone({ onUploaded, accept }: { onUploaded?: (file: UploadedItem) => void; accept?: string }) {
  const [items, setItems] = useState<Item[]>([]);
  const [over, setOver] = useState(false);
  const next = useRef(0);
  const patch = (key: number, p: Partial<Item>) => setItems((l) => l.map((i) => (i.key === key ? { ...i, ...p } : i)));

  const run = async (key: number, file: File) => {
    patch(key, { step: "uploading", percent: 0, message: undefined });
    try {
      const link = await api<UploadLink>("/api/pramaan/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentType: file.type, sizeBytes: file.size }),
      });
      await sendBytes(link, file, (percent) => patch(key, { percent }));
      patch(key, { step: "checking", percent: 100 });
      await api<StoredFile>(`/api/pramaan/uploads/${encodeURIComponent(link.fileId)}/finish`, { method: "POST" });
      remember(link.fileId, file.name);
      patch(key, { step: "done" });
      onUploaded?.({ fileId: link.fileId, filename: file.name, contentType: file.type, sizeBytes: file.size });
      announceChange();
    } catch (e) {
      patch(key, { step: "failed", message: e instanceof ApiError ? e.message : "The upload didn't go through. Try again." });
    }
  };
  const add = (list: FileList | null) => {
    for (const file of Array.from(list ?? [])) {
      const key = next.current++;
      setItems((l) => [...l, { key, file, step: "uploading", percent: 0 }]);
      void run(key, file);
    }
  };

  return (
    <section aria-label="Upload files" className="space-y-3">
      <div
        className={`pr-card flex flex-col items-center gap-2 border-dashed text-center ${over ? "border-primary" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}
      >
        <p>Drag files here</p>
        <p className="text-sm text-muted-foreground">Images, audio, video, PDF, CSV, JSON or text files.</p>
        <label className="inline-flex h-9 cursor-pointer items-center rounded-md border px-4 text-sm font-medium focus-within:ring-2">
          Choose files
          <input type="file" multiple accept={accept} className="sr-only" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
        </label>
      </div>
      {items.length > 0 && (
        <ul aria-label="Uploads" className="space-y-2">
          {items.map((i) => (
            <li key={i.key} className="pr-card space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>{i.file.name} <span className="text-sm text-muted-foreground">{formatBytes(i.file.size)}</span></span>
                <span className="flex items-center gap-2">
                  <StatusPill tone={STEP[i.step].tone}>{STEP[i.step].text}</StatusPill>
                  {i.step === "failed" && <Button variant="outline" aria-label={`Try ${i.file.name} again`} onClick={() => run(i.key, i.file)}>Try again</Button>}
                </span>
              </div>
              {(i.step === "uploading" || i.step === "checking") && (
                <div role="progressbar" aria-label={`Uploading ${i.file.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={i.percent} className="h-2 overflow-hidden rounded bg-muted">
                  <div className="h-full bg-primary transition-all" style={{ width: `${i.percent}%` }} />
                </div>
              )}
              {i.message && <StatusMessage text={i.message} tone="error" />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The files you uploaded: open one, or delete it. Files are kept for 7 days. */
export function UploadedFiles({ pollMs = 30_000 }: { pollMs?: number }) {
  const r = useResource<{ results: StoredFile[] }>("/api/pramaan/uploads", pollMs);
  const [msg, setMsg] = useState<string>();
  if (r.loading && !r.data) return <LoadingState label="Loading your files" />;
  if (r.error && !r.data) return <ErrorState error={r.error} onRetry={r.reload} />;
  if (!r.data?.results.length) return <div className="space-y-2"><EmptyState title="No files yet">Files you upload show up here.</EmptyState><StatusMessage text={msg} tone="info" /></div>;
  const known = names();
  return (
    <div className="space-y-2">
      <ul aria-label="Files" className="space-y-2">
        {r.data.results.map((f) => {
          const label = known[f.fileId] ?? KIND[f.kind] ?? "File";
          return (
            <li key={f.fileId} className="pr-card flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium">{label}</p>
                <p className="text-sm text-muted-foreground">{KIND[f.kind] ?? "File"} · {formatBytes(f.sizeBytes)} · uploaded {formatDate(f.createdAt, { time: true })} · kept until {formatDate(f.expiresAt)}</p>
              </div>
              <div className="flex items-center gap-2">
                {f.url && <a className="text-sm underline" href={f.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${label}`}>Open</a>}
                <ConfirmAction
                  label={`Delete ${label}`}
                  title={`Delete ${label}?`}
                  description="The file is deleted now and its links stop working. This can't be undone."
                  confirmLabel="Delete"
                  variant="outline"
                  onConfirm={async () => {
                    try {
                      await api(`/api/pramaan/uploads/${encodeURIComponent(f.fileId)}`, { method: "DELETE" });
                      setMsg(`${label} was deleted.`);
                      announceChange();
                    } catch (e) {
                      setMsg(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
                    }
                  }}
                />
              </div>
            </li>
          );
        })}
      </ul>
      <StatusMessage text={msg} tone="info" />
    </div>
  );
}
