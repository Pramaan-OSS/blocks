"use client";

import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmAction } from "@/components/pramaan/confirm-action";
import { StatusPill, type PillTone } from "@/components/pramaan/parts";
import { EmptyState, ErrorState, LoadingState, StatusMessage } from "@/components/pramaan/states";
import { ApiError, announceChange, api, useResource } from "@/lib/pramaan/client";
import { formatDate } from "@/lib/pramaan/plain";
import type { SignerState, SigningDetail, SigningRow, SigningState } from "@/lib/pramaan/signing";

const post = <T,>(url: string, body: unknown, headers: Record<string, string> = {}) =>
  api<T>(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

const STATE: Record<SigningState, { text: string; tone: PillTone }> = {
  preparing: { text: "Getting ready", tone: "grey" },
  waiting: { text: "Waiting for signatures", tone: "amber" },
  opened: { text: "Opened, not signed", tone: "amber" },
  partly: { text: "Partly signed", tone: "blue" },
  signed: { text: "Signed by everyone", tone: "green" },
  declined: { text: "Declined", tone: "red" },
  cancelled: { text: "Cancelled", tone: "grey" },
  expired: { text: "Expired", tone: "grey" },
  failed: { text: "Didn't send", tone: "red" },
  unknown: { text: "Checking", tone: "grey" },
};
const SIGNER: Record<SignerState, { text: string; tone: PillTone }> = {
  waiting: { text: "Hasn't opened it", tone: "amber" },
  opened: { text: "Opened it", tone: "amber" },
  signed: { text: "Signed", tone: "green" },
  declined: { text: "Declined", tone: "red" },
  expired: { text: "Ran out of time", tone: "grey" },
  unknown: { text: "Checking", tone: "grey" },
};

export interface SignableDocument {
  /** The id of an uploaded file, for example from the upload block. */
  readonly fileId: string;
  /** Ends in .pdf, .png or .jpg. */
  readonly filename: string;
  readonly label?: string;
}

interface Person { name: string; email: string }

/**
 * Sends one document to be signed by email. `documents` is what the person may choose from; give
 * it the file ids your app holds (the upload block makes them). One click sends once, even if
 * it is clicked twice.
 */
export function SendForSignature({ documents }: { documents: readonly SignableDocument[] }) {
  const id = useId();
  const [doc, setDoc] = useState(documents[0]?.fileId ?? "");
  const [title, setTitle] = useState("");
  const [people, setPeople] = useState<Person[]>([{ name: "", email: "" }]);
  const [msg, setMsg] = useState<{ text?: string; tone: "success" | "error" | "info" }>({ tone: "info" });
  const [busy, setBusy] = useState(false);
  const key = useRef<string>(undefined);
  const set = (i: number, patch: Partial<Person>) => setPeople((p) => p.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const chosen = documents.find((d) => d.fileId === doc);

  if (documents.length === 0) return <EmptyState title="No document to send">Add a document first, then come back to send it for signing.</EmptyState>;

  return (
    <form
      aria-label="Send for signing"
      className="pr-card space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy || !chosen) return;
        setBusy(true);
        setMsg({ tone: "info", text: "Sending…" });
        key.current = crypto.randomUUID();
        try {
          const r = await post<{ needsApproval: boolean }>("/api/pramaan/signing", { title, fileId: chosen.fileId, filename: chosen.filename, signers: people }, { "Idempotency-Key": key.current });
          setMsg(r.needsApproval
            ? { tone: "info", text: "This is waiting for a team member to say yes. Once they do, everyone gets an email." }
            : { tone: "success", text: "Sent. Each person got an email with a link to sign." });
          setTitle("");
          setPeople([{ name: "", email: "" }]);
          announceChange();
        } catch (err) {
          setMsg({ tone: "error", text: err instanceof ApiError ? err.message : "Something went wrong. Try again." });
        } finally {
          setBusy(false);
        }
      }}
    >
      {documents.length > 1 && (
        <div className="space-y-1">
          <Label htmlFor={`${id}-doc`}>Document</Label>
          <select id={`${id}-doc`} className="pr-select" value={doc} onChange={(e) => setDoc(e.target.value)}>
            {documents.map((d) => <option key={d.fileId} value={d.fileId}>{d.label ?? d.filename}</option>)}
          </select>
        </div>
      )}
      {documents.length === 1 && <p className="text-sm">Document: <strong>{documents[0].label ?? documents[0].filename}</strong></p>}
      <div className="space-y-1">
        <Label htmlFor={`${id}-title`}>Title</Label>
        <Input id={`${id}-title`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} placeholder="Service agreement" required />
      </div>
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Who needs to sign</legend>
        {people.map((p, i) => (
          <div key={i} className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
            <div className="space-y-1">
              <Label htmlFor={`${id}-n${i}`}>Name {i + 1}</Label>
              <Input id={`${id}-n${i}`} value={p.name} onChange={(e) => set(i, { name: e.target.value })} maxLength={100} required />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${id}-e${i}`}>Email {i + 1}</Label>
              <Input id={`${id}-e${i}`} type="email" value={p.email} onChange={(e) => set(i, { email: e.target.value })} required />
            </div>
            {people.length > 1 && (
              <Button type="button" variant="outline" className="self-end" aria-label={`Remove person ${i + 1}`} onClick={() => setPeople((l) => l.filter((_, j) => j !== i))}>
                Remove
              </Button>
            )}
          </div>
        ))}
        {people.length < 20 && (
          <Button type="button" variant="outline" onClick={() => setPeople((l) => [...l, { name: "", email: "" }])}>Add another person</Button>
        )}
      </fieldset>
      <p className="text-sm text-muted-foreground">Each person gets an email and signs on a secure page. We never see their signature.</p>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy}>Send for signing</Button>
        <StatusMessage text={msg.text} tone={msg.tone} />
      </div>
    </form>
  );
}

function Detail({ id, onClose }: { id: string; onClose: () => void }) {
  const r = useResource<SigningDetail>(`/api/pramaan/signing/${encodeURIComponent(id)}`, 10_000);
  const [msg, setMsg] = useState<{ text?: string; tone: "success" | "error" | "info" }>({ tone: "info" });
  if (r.loading && !r.data) return <LoadingState label="Loading the agreement" />;
  if (r.error && !r.data) return <ErrorState error={r.error} onRetry={r.reload} />;
  const d = r.data!;
  const w = STATE[d.state];
  return (
    <section aria-label="Agreement" className="pr-card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2>{d.title}</h2>
        <StatusPill tone={w.tone}>{w.text}</StatusPill>
      </div>
      {d.createdAt && <p className="text-sm text-muted-foreground">Sent {formatDate(d.createdAt, { time: true })}{d.completedAt ? ` · finished ${formatDate(d.completedAt, { time: true })}` : ""}</p>}
      <ul className="space-y-2" aria-label="Signers">
        {d.signers.map((s) => (
          <li key={s.email} className="flex flex-wrap items-center justify-between gap-2 border-t pt-2">
            <span>{s.name} <span className="text-sm text-muted-foreground">{s.email}</span></span>
            <span className="flex items-center gap-2">
              <StatusPill tone={SIGNER[s.state].tone}>{SIGNER[s.state].text}</StatusPill>
              {s.signedAt && <span className="text-sm text-muted-foreground">{formatDate(s.signedAt, { time: true })}</span>}
              {(s.state === "waiting" || s.state === "opened") && d.state !== "cancelled" && (
                <ConfirmAction
                  label={`Remind ${s.name}`}
                  title={`Email a reminder to ${s.name}?`}
                  description="They get one email asking them to sign. This can't be taken back once it's sent."
                  confirmLabel="Send reminder"
                  variant="outline"
                  onConfirm={async () => {
                    try {
                      await post(`/api/pramaan/signing/${encodeURIComponent(id)}/remind`, { email: s.email });
                      setMsg({ tone: "success", text: `Reminder sent to ${s.name}.` });
                    } catch (err) {
                      setMsg({ tone: "error", text: err instanceof ApiError ? err.message : "Something went wrong. Try again." });
                    }
                  }}
                />
              )}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        {d.downloadable && (
          <Button
            onClick={async () => {
              try {
                const { url } = await api<{ url: string }>(`/api/pramaan/signing/${encodeURIComponent(id)}/download`);
                window.open(url, "_blank", "noopener");
              } catch (err) {
                setMsg({ tone: "error", text: err instanceof ApiError ? err.message : "Something went wrong. Try again." });
              }
            }}
          >
            Open the signed copy
          </Button>
        )}
        <Button variant="outline" onClick={onClose}>Back to the list</Button>
        <StatusMessage text={msg.text} tone={msg.tone} />
      </div>
    </section>
  );
}

/** What you sent for signing and where each one stands. Updates by itself. */
export function SigningList({ pollMs = 10_000 }: { pollMs?: number }) {
  const r = useResource<{ results: SigningRow[] }>("/api/pramaan/signing", pollMs);
  const [open, setOpen] = useState<string>();
  if (open) return <Detail id={open} onClose={() => setOpen(undefined)} />;
  if (r.loading && !r.data) return <LoadingState label="Loading your agreements" />;
  if (r.error && !r.data) return <ErrorState error={r.error} onRetry={r.reload} />;
  if (!r.data?.results.length) return <EmptyState title="Nothing sent yet">Agreements you send for signing show up here.</EmptyState>;
  return (
    <ul aria-label="Agreements" className="space-y-2">
      {r.data.results.map((a) => (
        <li key={a.ref} className="pr-card flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-medium">{a.title}</p>
            {a.createdAt && <p className="text-sm text-muted-foreground">Sent {formatDate(a.createdAt, { time: true })}</p>}
          </div>
          <div className="flex items-center gap-2">
            <StatusPill tone={STATE[a.state].tone}>{STATE[a.state].text}</StatusPill>
            <Button variant="outline" aria-label={`Open ${a.title}`} onClick={() => setOpen(a.ref)}>Open</Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
