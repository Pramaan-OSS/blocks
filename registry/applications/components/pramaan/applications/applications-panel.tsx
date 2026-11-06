"use client";
import { useRef, useState, type FormEvent } from "react";
import { api, useResource } from "@/lib/pramaan/client";
import { Button } from "@/components/ui/button";
import { StatusPill, type PillTone } from "@/components/pramaan/parts";
import { SafetyActions } from "@/components/pramaan/moderation/moderation-panel";
import { formatDate } from "@/lib/pramaan/plain";
import type { Applicant, ApplicantsData, ApplicationStatus, FileView, HistoryEntry, OwnApplication, OwnApplications } from "@/lib/pramaan/applications";
import type { ListingPage } from "@/lib/pramaan/listings";
import type { UploadLink } from "@/lib/pramaan/upload";
const field = "block w-full rounded border bg-background p-2";
const ROUTE = "/api/pramaan/applications";
const FILE_TYPES = "application/pdf,image/png,image/jpeg,image/webp,text/plain";
const WORDS: Record<ApplicationStatus, { label: string; tone: PillTone; action: string }> = {
  new: { label: "New", tone: "amber", action: "Move back to new" },
  shortlisted: { label: "Shortlisted", tone: "blue", action: "Shortlist" },
  declined: { label: "Declined", tone: "grey", action: "Decline" },
  accepted: { label: "Accepted", tone: "green", action: "Accept" },
};
const sorry = (e: unknown) => e instanceof Error ? e.message : "Couldn't finish that. Try again.";
type Token = { getBotCheckToken?: () => Promise<string> };
async function send<T>(body: object, token: Token["getBotCheckToken"]) {
  return api<T>(ROUTE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, botCheckToken: await token?.() }) });
}
async function attach(id: string, file: File, token: Token["getBotCheckToken"]) {
  const link = await send<UploadLink>({ action: "file-start", id, contentType: file.type, sizeBytes: file.size }, token);
  const response = await fetch(link.uploadUrl, { method: "PUT", headers: link.headers, body: file });
  if (!response.ok) throw new Error("The file didn't upload. Try again.");
  await send({ action: "file-finish", id, fileId: link.fileId }, token);
}
const Status = ({ status }: { status: ApplicationStatus }) => <StatusPill tone={WORDS[status].tone}>{WORDS[status].label}</StatusPill>;
const Attachment = ({ file }: { file?: FileView }) => file ? <p>{file.url ? <a className="underline" href={file.url} target="_blank" rel="noreferrer">Open attached file ({file.label})</a> : "The attached file has expired."}</p> : null;
const History = ({ entries }: { entries: HistoryEntry[] }) => <ol aria-label="Status history" className="text-sm text-muted-foreground">{entries.map(h => <li key={`${h.at}-${h.status}`}>{WORDS[h.status].label}, set by {h.by} · {formatDate(h.at, { time: true })}</li>)}</ol>;

/** The application form for one listing. A failed file upload never loses the application. */
export function ApplyPanel({ listing, getBotCheckToken }: { listing: string } & Token) {
  const { data, error, loading, reload } = useResource<ListingPage>(`/api/pramaan/listings?id=${encodeURIComponent(listing)}`);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const form = new FormData(event.currentTarget);
    const file = form.get("file") as File | null;
    setBusy(true); setMessage("");
    try {
      const { id } = await send<{ id: string }>({ action: "apply", listingId: listing, name: form.get("name"), message: form.get("message") }, getBotCheckToken);
      setSent(true); setMessage("Application sent.");
      if (file?.size) await attach(id, file, getBotCheckToken).catch(() => setMessage("Application sent, but the file didn't upload. You can add it from your applications."));
    } catch (e) { setMessage(sorry(e)); }
    finally { setBusy(false); }
  }
  if (loading) return <p role="status">Loading listing…</p>;
  if (error) return <div role="alert">{error.message} <Button variant="outline" onClick={reload}>Try again</Button></div>;
  if (!data) return null;
  const refusal = !data.signedIn ? "Sign in to apply." : data.mine ? "This is your listing." : data.status !== "open" ? "This listing is closed." : "";
  return <section aria-label="Apply" className="max-w-xl space-y-4">
    <h2 className="font-serif text-2xl">Apply to {data.title}</h2>
    {refusal && <p>{refusal}</p>}
    {!refusal && !sent && <form onSubmit={submit} className="space-y-3"><fieldset disabled={busy} className="space-y-3">
      <label className="block">Your name<input required maxLength={100} name="name" className={field} /></label>
      <label className="block">Message<textarea required maxLength={4000} rows={6} name="message" className={field} /></label>
      <label className="block">File, optional<input type="file" name="file" accept={FILE_TYPES} className={field} /></label>
      <p className="text-sm text-muted-foreground">PDF, image or text, up to 10 MB. Only the listing's owner can open it, and uploaded files are kept 7 days.</p>
      <Button type="submit">Send application</Button>
    </fieldset></form>}
    <p role="status" aria-live="polite">{message}</p>
    {sent && <a className="underline" href="/applications">See your applications</a>}
  </section>;
}

function OwnCard({ application: a, busy, addFile }: { application: OwnApplication; busy: boolean; addFile: (id: string, file: File) => void }) {
  return <li className="space-y-2 py-4">
    <div className="flex flex-wrap items-center gap-3"><h2 className="font-serif text-xl">{a.listing ? <a className="underline" href={`/listings/${a.listing.id}`}>{a.listing.title}</a> : "This listing is no longer available"}</h2><Status status={a.status} /></div>
    <p className="text-sm text-muted-foreground">Applied {formatDate(a.appliedAt)}{a.listing && !a.listing.open && " · Listing closed"}</p>
    <p className="whitespace-pre-wrap">{a.message}</p>
    <Attachment file={a.file} />
    {!a.file && <label className="block text-sm">Add a file to this application<input type="file" accept={FILE_TYPES} disabled={busy} className={field} onChange={event => { const file = event.target.files?.[0]; if (file) addFile(a.id, file); event.target.value = ""; }} /></label>}
    {a.messages.length > 0 && <><h3 className="font-semibold">Messages from the listing owner</h3><ul className="space-y-2">{a.messages.map(m => <li key={m.at} className="rounded border p-3"><p className="whitespace-pre-wrap">{m.text}</p><time className="text-sm text-muted-foreground" dateTime={m.at}>{formatDate(m.at, { time: true })}</time></li>)}</ul></>}
    <History entries={a.history} />
  </li>;
}
/** The signed-in person's own applications and where each one stands. */
export function MyApplications({ getBotCheckToken }: Token) {
  const { data, error, loading, reload } = useResource<OwnApplications>(ROUTE);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function addFile(id: string, file: File) {
    if (busy) return; setBusy(true); setMessage("");
    try { await attach(id, file, getBotCheckToken); setMessage("File added."); }
    catch (e) { setMessage(sorry(e)); }
    finally { setBusy(false); reload(); }
  }
  if (loading) return <p role="status">Loading your applications…</p>;
  if (error) return <div role="alert">{error.message} <Button variant="outline" onClick={reload}>Try again</Button></div>;
  return <div className="space-y-4">
    <p role="status" aria-live="polite">{message}</p>
    {!data?.applications.length && <p>You haven't applied to a listing yet.</p>}
    <ul aria-label="Your applications" className="divide-y">{data?.applications.map(a => <OwnCard key={a.id} application={a} busy={busy} addFile={(id, file) => void addFile(id, file)} />)}</ul>
  </div>;
}

const noticeWords = (m: Applicant["messages"][number]) => m.notice === "sent" ? "Email sent." : m.notice === "pending" && !m.note ? "Email on its way." : m.note;
function ApplicantCard({ applicant: a, messagingOff, busy, act, getBotCheckToken }: { applicant: Applicant; messagingOff: boolean; busy: boolean; act: (body: object, done: string) => Promise<boolean> } & Token) {
  const [text, setText] = useState("");
  // One id per draft: sending the same draft again after a dropped connection emails once.
  const draft = useRef<string | undefined>(undefined);
  async function message(event: FormEvent) {
    event.preventDefault();
    draft.current ??= crypto.randomUUID();
    if (await act({ action: "message", id: a.id, requestId: draft.current, text }, "Message saved.")) { draft.current = undefined; setText(""); }
  }
  return <li aria-label={a.name} className="space-y-3 py-4">
    <div className="flex flex-wrap items-center gap-3"><h3 className="font-serif text-xl">{a.name}</h3><Status status={a.status} /></div>
    <p className="text-sm text-muted-foreground">Applied {formatDate(a.appliedAt)}</p>
    <p className="whitespace-pre-wrap">{a.message}</p>
    <Attachment file={a.file} />
    <div className="flex flex-wrap gap-2">{(Object.keys(WORDS) as ApplicationStatus[]).filter(s => s !== a.status).map(s => <Button key={s} variant="outline" disabled={busy} aria-label={`${WORDS[s].action}: ${a.name}`} onClick={() => void act({ action: "move", id: a.id, revision: a.revision, status: s }, `${a.name}: ${WORDS[s].label}.`)}>{WORDS[s].action}</Button>)}</div>
    <History entries={a.history} />
    {a.messages.length > 0 && <ul aria-label={`Messages to ${a.name}`} className="space-y-2">{a.messages.map(m => <li key={m.at} className="rounded border p-3"><p className="whitespace-pre-wrap">{m.text}</p><p className="text-sm text-muted-foreground">{formatDate(m.at, { time: true })} · {noticeWords(m)}</p></li>)}</ul>}
    {messagingOff ? <p>This listing is hidden, so messages are off.</p> : <form onSubmit={message} className="space-y-2">
      <label className="block">Message {a.name}<textarea required maxLength={2000} className={field} value={text} onChange={e => setText(e.target.value)} disabled={busy} /></label>
      <p className="text-sm text-muted-foreground">They read it in their applications. An email tells them it's there, without your words.</p>
      <Button type="submit" disabled={busy}>Send message</Button>
    </form>}
    <details><summary className="cursor-pointer">Report or block {a.name}</summary><div className="pt-3"><SafetyActions kind="person" target={a.person} label={a.name} getBotCheckToken={getBotCheckToken} /></div></details>
  </li>;
}
/** The listing owner's view: applicants, status moves and messages. The API enforces who may see it. */
export function ApplicantsPanel({ listing, getBotCheckToken }: { listing: string } & Token) {
  const { data, error, loading, reload } = useResource<ApplicantsData>(`${ROUTE}?listing=${encodeURIComponent(listing)}`);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function act(body: object, done: string) {
    if (busy) return false;
    setBusy(true); setMessage("");
    try {
      const result = await send<{ notice?: string; note?: string }>(body, getBotCheckToken);
      setMessage(result.note || done); return true;
    } catch (e) { setMessage(sorry(e)); return false; }
    finally { setBusy(false); reload(); }
  }
  if (loading) return <p role="status">Loading applicants…</p>;
  if (error) return <div role="alert">{error.message} <Button variant="outline" onClick={reload}>Try again</Button></div>;
  if (!data) return null;
  return <section aria-label="Applicants" className="space-y-4">
    <h2 className="font-serif text-2xl">Applicants for {data.title}</h2>
    <p role="status" aria-live="polite">{message}</p>
    {!data.applicants.length && <p>No applications yet.</p>}
    <ul className="divide-y">{data.applicants.map(a => <ApplicantCard key={a.id} applicant={a} messagingOff={data.messagingOff} busy={busy} act={act} getBotCheckToken={getBotCheckToken} />)}</ul>
  </section>;
}
