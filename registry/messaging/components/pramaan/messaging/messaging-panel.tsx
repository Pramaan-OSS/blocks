"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { SendHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmAction } from "@/components/pramaan/confirm-action";
import { EmptyState, ErrorState, LoadingState, SignedOutState, StatusMessage } from "@/components/pramaan/states";
import { api, useResource } from "@/lib/pramaan/client";
import { formatDate } from "@/lib/pramaan/plain";
import type { Conversation, Message, Thread } from "@/lib/pramaan/messaging";

type Token = () => Promise<string>;
const URL_BASE = "/api/pramaan/messages";
const errorText = (e: unknown) => e instanceof Error ? e.message : "Couldn't finish that. Try again.";
const nameOf = (person: Conversation["person"]) => person.name || "Community member";
async function send<T>(body: Record<string, unknown>, getBotCheckToken?: Token) {
  return api<T>(URL_BASE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, botCheckToken: await getBotCheckToken?.() }) });
}
function ReportMessage({ conversation, message, getBotCheckToken }: { conversation: string; message: string; getBotCheckToken?: Token }) {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    setBusy(true); setStatus("");
    try { await send({ action: "report", id: conversation, message, reason: new FormData(form).get("reason") }, getBotCheckToken); form.reset(); setStatus("Report sent."); }
    catch (e) { setStatus(errorText(e)); }
    finally { setBusy(false); }
  }
  return <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">Report message</summary>
    <form onSubmit={submit} className="mt-2 space-y-2">
      <label className="block">Why are you reporting this?<Textarea required maxLength={1000} name="reason" disabled={busy} /></label>
      <Button type="submit" size="sm" variant="outline" disabled={busy}>Send report</Button>
      <StatusMessage text={status} />
    </form>
  </details>;
}
function ThreadView({ id, pollMs, onChanged, onClosed, getBotCheckToken }: { id: string; pollMs: number; onChanged: () => void; onClosed: () => void; getBotCheckToken?: Token }) {
  // ponytail: each poll reads the newest 50, so more than 50 arriving between polls leaves a gap until reopened.
  const { data, error, reload } = useResource<Thread>(`${URL_BASE}?conversation=${encodeURIComponent(id)}`, pollMs);
  const [older, setOlder] = useState<Message[]>([]);
  const [earlier, setEarlier] = useState<string | null>();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const log = useRef<HTMLDivElement>(null);
  const seen = useRef<string>(undefined);
  const newest = data?.messages.at(-1)?.id;
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [newest]);
  // Reading marks the conversation read: only for a message this screen is showing to someone.
  useEffect(() => {
    const incoming = data?.messages.filter(m => !m.mine).at(-1)?.id;
    if (!incoming || incoming === seen.current || document.visibilityState !== "visible") return;
    seen.current = incoming;
    void send({ action: "read", id }, getBotCheckToken).then(onChanged, () => { seen.current = undefined; });
  }, [data, id, getBotCheckToken, onChanged]);
  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (busy || !draft.trim()) return;
    setBusy(true); setStatus("");
    try { await send({ action: "send", id, text: draft }, getBotCheckToken); setDraft(""); reload(); onChanged(); }
    catch (e) { setStatus(errorText(e)); }
    finally { setBusy(false); }
  }
  async function loadEarlier() {
    const before = earlier === undefined ? data?.earlier : earlier;
    if (!before || busy) return;
    setBusy(true);
    try {
      const page = await api<Thread>(`${URL_BASE}?conversation=${encodeURIComponent(id)}&before=${encodeURIComponent(before)}`);
      setOlder(all => [...page.messages, ...all]); setEarlier(page.earlier ?? null);
    } catch (e) { setStatus(errorText(e)); }
    finally { setBusy(false); }
  }
  if (error && (!data || error.status === 404)) return <ErrorState error={error} onRetry={error.status === 404 ? undefined : reload} />;
  if (!data) return <LoadingState label="Loading messages" />;
  const more = earlier === undefined ? data.earlier : earlier;
  const name = nameOf(data.person);
  const shown = [...older.filter(m => !data.messages.some(x => x.id === m.id)), ...data.messages];
  const lastMine = shown.filter(m => m.mine).at(-1)?.id;
  return <section aria-label={`Conversation with ${name}`} className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card text-card-foreground shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
      <h2 className="font-serif text-xl">{name}</h2>
      <ConfirmAction label="Block person" title={`Block ${name}?`} description="You won't be able to message each other and this conversation leaves your list. You can unblock them later." variant="outline" disabled={busy} onConfirm={async () => {
        try { await send({ action: "block", person: data.person.ref }, getBotCheckToken); onClosed(); }
        catch (e) { setStatus(errorText(e)); }
      }} />
    </div>
    <div ref={log} role="log" aria-label="Messages" aria-live="polite" className="min-h-[280px] max-h-[55vh] flex-1 space-y-3 overflow-y-auto p-4">
      {more && <Button size="sm" variant="outline" disabled={busy} onClick={() => void loadEarlier()}>Show earlier messages</Button>}
      {!shown.length && <EmptyState title="No messages yet">Say hello.</EmptyState>}
      {shown.map(m => <div key={m.id} className={m.mine ? "ml-auto max-w-[85%] rounded-2xl bg-primary/10 px-4 py-2 text-sm" : "max-w-[85%] space-y-1 text-sm"}>
        <p className="whitespace-pre-wrap break-words">{m.text}</p>
        <p className="text-xs text-muted-foreground"><time dateTime={m.at}>{formatDate(m.at, { time: true })}</time>{m.id === lastMine && m.read && " · Read"}</p>
        {!m.mine && <ReportMessage conversation={id} message={m.id} getBotCheckToken={getBotCheckToken} />}
      </div>)}
    </div>
    <StatusMessage tone="error" text={status} />
    <form className="flex flex-col gap-1 border-t p-3" onSubmit={submit}>
      <Label htmlFor="pramaan-message" className="sr-only">Your message</Label>
      <div className="flex items-stretch gap-2">
        <Textarea
          id="pramaan-message"
          aria-describedby="pramaan-message-hint"
          placeholder="Write a message"
          className="min-h-0 min-w-0 flex-1 resize-none"
          rows={2}
          maxLength={4000}
          value={draft}
          disabled={busy}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            // Enter sends. Shift+Enter is a new line. While an input method is composing, Enter belongs to it.
            if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
            e.preventDefault();
            if (!busy && draft.trim()) e.currentTarget.form?.requestSubmit();
          }}
        />
        <Button type="submit" className="!h-auto" disabled={busy || !draft.trim()}><SendHorizontal aria-hidden className="size-4" />Send</Button>
      </div>
      <p id="pramaan-message-hint" className="text-xs text-muted-foreground">Enter to send, Shift + Enter for a new line</p>
    </form>
  </section>;
}
/**
 * The conversation list and the open conversation. New messages arrive by polling: `pollMs` for the
 * open conversation, `listPollMs` for the list. Open `?with=<person>` to start or reopen a conversation.
 */
export function MessagingPanel({ pollMs = 3_000, listPollMs = 5_000, getBotCheckToken }: { pollMs?: number; listPollMs?: number; getBotCheckToken?: Token } = {}) {
  const { data, error, reload } = useResource<{ conversations: Conversation[] }>(URL_BASE, listPollMs);
  const [open, setOpen] = useState<string>();
  const [status, setStatus] = useState("");
  const started = useRef(false);
  useEffect(() => {
    const person = new URLSearchParams(window.location.search).get("with");
    if (!person || started.current) return;
    started.current = true;
    send<{ id: string }>({ action: "start", person }, getBotCheckToken).then(({ id }) => { setOpen(id); reload(); }, e => setStatus(errorText(e)));
  }, [getBotCheckToken, reload]);
  if (error?.status === 401) return <SignedOutState reason="Your conversations are private to you." />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <LoadingState label="Loading conversations" />;
  return <div className="grid gap-4 md:grid-cols-[18rem_minmax(0,1fr)]">
    <section aria-label="Conversations" className="space-y-2">
      <h2 className="font-serif text-xl">Conversations</h2>
      <StatusMessage tone="error" text={status} />
      {!data.conversations.length && <EmptyState title="No conversations yet">Open someone's profile page and choose Message.</EmptyState>}
      <ul className="space-y-1">{data.conversations.map(c => <li key={c.id}>
        <button aria-current={c.id === open ? "true" : undefined} onClick={() => { setOpen(c.id); setStatus(""); }} className="w-full rounded border p-3 text-left hover:bg-muted aria-[current]:bg-muted">
          <span className="flex items-center justify-between gap-2"><b className="truncate">{nameOf(c.person)}</b>{c.unread > 0 && <span className="pr-pill" data-tone="blue">{c.unread} unread</span>}</span>
          {c.preview && <span className="block truncate text-sm text-muted-foreground">{c.preview}</span>}
        </button>
      </li>)}</ul>
    </section>
    {open
      ? <ThreadView key={open} id={open} pollMs={pollMs} onChanged={reload} onClosed={() => { setOpen(undefined); reload(); }} getBotCheckToken={getBotCheckToken} />
      : <p className="p-4 text-muted-foreground">Choose a conversation to read it.</p>}
  </div>;
}
