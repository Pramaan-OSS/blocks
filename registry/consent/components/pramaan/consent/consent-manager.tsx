"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusPill } from "@/components/pramaan/parts";
import { EmptyState, ErrorState, LoadingState, StatusMessage, type StatusTone } from "@/components/pramaan/states";
import { ApiError, announceChange, api, useResource } from "@/lib/pramaan/client";
import { formatDate } from "@/lib/pramaan/plain";
import type { Channel, Entry, OptOutList, Scope, Source } from "@/lib/pramaan/consent";

const CHANNEL: Record<Scope, string> = { sms: "Text messages", whatsapp: "WhatsApp", voice: "Calls", email: "Email", all: "Every channel" };
const SOURCE: Record<Source, { text: string; tone: "grey" | "amber" | "blue" }> = {
  builder_api: { text: "You added it", tone: "grey" },
  inbound_stop: { text: "They replied STOP", tone: "amber" },
  unsubscribe_link: { text: "They unsubscribed", tone: "blue" },
};

const send = <T,>(url: string, body: unknown) => api<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

function ChannelSelect({ id, value, onChange, all = true }: { id: string; value: string; onChange: (v: string) => void; all?: boolean }) {
  return (
    <select id={id} className="pr-select" value={value} onChange={(e) => onChange(e.target.value)}>
      {(Object.keys(CHANNEL) as Scope[]).filter((k) => all || k !== "all").map((k) => (
        <option key={k} value={k}>
          {CHANNEL[k]}
        </option>
      ))}
    </select>
  );
}

/** Whether a message to this contact would be refused: one pill, for a contact page or list. */
export function ConsentBadge({ address, channel = "sms" }: { address: string; channel?: Channel }) {
  const r = useResource<{ blocked: boolean }>(`/api/pramaan/consent/check?address=${encodeURIComponent(address)}&channel=${channel}`);
  if (r.error) return <StatusPill tone="grey">Can't tell</StatusPill>;
  if (!r.data) return <StatusPill tone="grey">Checking…</StatusPill>;
  return r.data.blocked ? <StatusPill tone="amber">Opted out of {CHANNEL[channel].toLowerCase()}</StatusPill> : <StatusPill tone="green">OK to message</StatusPill>;
}

function CheckForm() {
  const id = useId();
  const [address, setAddress] = useState("");
  const [channel, setChannel] = useState<string>("sms");
  const [answer, setAnswer] = useState<{ text: string; tone: StatusTone }>();
  return (
    <form
      aria-label="Check a contact"
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          const r = await api<{ blocked: boolean }>(`/api/pramaan/consent/check?address=${encodeURIComponent(address)}&channel=${channel}`);
          setAnswer(r.blocked ? { text: `${CHANNEL[channel as Scope]} to this contact would be refused: they opted out.`, tone: "error" } : { text: `${CHANNEL[channel as Scope]} to this contact would go through.`, tone: "success" });
        } catch (err) {
          setAnswer({ text: err instanceof ApiError ? err.message : "Something went wrong. Try again.", tone: "error" });
        }
      }}
    >
      <h3>Check a contact</h3>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-56 flex-1 space-y-1.5">
          <Label htmlFor={`${id}-a`}>Phone number or email</Label>
          <Input id={`${id}-a`} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="+14155550100" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-c`}>How you would reach them</Label>
          <ChannelSelect id={`${id}-c`} value={channel} onChange={setChannel} all={false} />
        </div>
        <Button type="submit" variant="outline">
          Check
        </Button>
      </div>
      <StatusMessage text={answer?.text} tone={answer?.tone} />
    </form>
  );
}

function AddForm({ onAdded }: { onAdded: () => void }) {
  const id = useId();
  const [address, setAddress] = useState("");
  const [channel, setChannel] = useState<string>("all");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState<{ text: string; tone: StatusTone }>();
  return (
    <form
      aria-label="Add an opt-out"
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await send("/api/pramaan/consent", { address, channel, reason });
          setNote({ text: `Done. ${CHANNEL[channel as Scope]} to this contact are now blocked.`, tone: "success" });
          setAddress("");
          setReason("");
          announceChange();
          onAdded();
        } catch (err) {
          setNote({ text: err instanceof ApiError ? err.message : "Something went wrong. Try again.", tone: "error" });
        }
      }}
    >
      <h3>Add an opt-out</h3>
      <p className="text-sm text-muted-foreground">Nothing you send through Pramaan will reach them on that channel until you remove it.</p>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-a`}>Phone number or email *</Label>
          <Input id={`${id}-a`} value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-c`}>Block</Label>
          <ChannelSelect id={`${id}-c`} value={channel} onChange={setChannel} />
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor={`${id}-r`}>Why (for your own records)</Label>
          <Input id={`${id}-r`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
        </div>
      </div>
      <Button type="submit">Add opt-out</Button>
      <StatusMessage text={note?.text} tone={note?.tone} />
    </form>
  );
}

function Row({ e, canRemove, onRemoved }: { e: Entry; canRemove: boolean; onRemoved: (text: string, tone: StatusTone) => void }) {
  const [open, setOpen] = useState(false);
  const [problem, setProblem] = useState<string>();
  const source = SOURCE[e.source];
  // Only an entry the project added can be lifted; a person's own STOP or unsubscribe stays.
  const removable = canRemove && e.source === "builder_api" && !e.removedAt;
  return (
    <li className="border-b last:border-0">
      <div className="pr-row" style={{ borderBottom: 0 }}>
        <span className="pr-row-main">
          <b>{e.addressHint}</b>
          <span className="pr-row-sub">
            {CHANNEL[e.channel]} · added {formatDate(e.createdAt, { time: false })}
            {e.reason ? ` · ${e.reason}` : ""}
            {e.createdBy ? " · addition recorded" : ""}
            {e.removedAt ? ` · removed ${formatDate(e.removedAt)}${e.removedBy ? " (reviewer recorded)" : ""}` : ""}
          </span>
        </span>
        <span className="pr-row-side">
          <StatusPill tone={source.tone}>{source.text}</StatusPill>
          {removable && !open && (
            <Button variant="outline" size="sm" aria-label={`Remove ${e.addressHint}`} onClick={() => setOpen(true)}>
              Remove
            </Button>
          )}
        </span>
      </div>
      {open && (
        <form
          aria-label={`Let ${e.addressHint} be messaged again`}
          className="pr-sunk mb-3 space-y-2"
          onSubmit={async (ev) => {
            ev.preventDefault();
            try {
              const r = await send<{ removed?: number; status: string }>("/api/pramaan/consent/remove", { optOutId: e.optOutId });
              onRemoved(r.status === "waiting_for_approval" ? "Removal is waiting for approval in the inbox." : "Removal completed.", r.status === "waiting_for_approval" ? "info" : "success");
              setOpen(false);
            } catch (err) {
              setProblem(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
            }
          }}
        >
          <p className="text-sm">This requests approval to let them be messaged again. The workspace keeps a record of who approved it.</p>
          {problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}
          <div className="flex gap-2">
            <Button type="submit" >
              Let them be messaged again
            </Button>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </li>
  );
}

/**
 * Your opt-out list: check a contact, add an opt-out, search the list, and (for approvers) let someone
 * be messaged again. People who replied STOP show read-only: only they can lift that.
 */
export function ConsentManager() {
  const [extra, setExtra] = useState<Entry[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [more, setMore] = useState(false);
  const [q, setQ] = useState("");
  const [channel, setChannel] = useState("");
  const [source, setSource] = useState("");
  const [removed, setRemoved] = useState(false);
  const filters = new URLSearchParams({ query: q, channel, source, removed: String(removed) });
  const list = useResource<OptOutList>(`/api/pramaan/consent?${filters}`);
  const [note, setNote] = useState<{ text: string; tone: StatusTone }>();
  if (list.error && !list.data) return <ErrorState error={list.error} onRetry={list.reload} />;
  if (!list.data) return <LoadingState label="Loading opt-outs" />;

  const next = more ? cursor : list.data.nextCursor;
  const rows = [...list.data.results, ...extra];
  const words = q.toLowerCase().trim();
  const shown = rows;

  async function showMore() {
    const page = await api<OptOutList>(`/api/pramaan/consent?${filters}&cursor=${encodeURIComponent(next!)}`);
    setExtra((x) => [...x, ...page.results]);
    setCursor(page.nextCursor);
    setMore(true);
  }

  return (
    <div className="space-y-8">
      <div className="grid gap-8 md:grid-cols-2">
        <CheckForm />
        <AddForm onAdded={() => { setExtra([]); setMore(false); list.reload(); }} />
      </div>

      <section aria-label="Opt-out list" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2>{removed ? "Removal history" : "People you won't message"}</h2>
          <select aria-label="Filter channel" className="pr-select" value={channel} onChange={(e) => { setChannel(e.target.value); setExtra([]); setMore(false); }}>
            <option value="">Any channel</option>{Object.entries(CHANNEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select aria-label="Filter source" className="pr-select" value={source} onChange={(e) => { setSource(e.target.value); setExtra([]); setMore(false); }}>
            <option value="">Any source</option>{Object.entries(SOURCE).map(([k, v]) => <option key={k} value={k}>{v.text}</option>)}
          </select>
          <Button variant="outline" onClick={() => { setRemoved(!removed); setExtra([]); setMore(false); }}>{removed ? "Active opt-outs" : "Removal history"}</Button>
          <div className="space-y-1.5">
            <Label htmlFor="consent-search">Search the list</Label>
            <Input id="consent-search" value={q} onChange={(e) => { setQ(e.target.value); setExtra([]); setMore(false); }} placeholder="Part of the shortened address" />
          </div>
        </div>
        <p className="text-sm text-muted-foreground">Addresses are shown shortened, to protect people's privacy. Removal needs approval.</p>
        <StatusMessage text={note?.text} tone={note?.tone} />
        {shown.length === 0 ? (
          <EmptyState title={words ? "Nothing matches" : "Nobody has opted out"}>{words ? "Try another part of the shortened address." : "People you add, and people who reply STOP or unsubscribe, are listed here."}</EmptyState>
        ) : (
          <ul className="pr-rows" aria-label="Opt-outs">
            {shown.map((e) => (
              <Row key={e.optOutId} e={e} canRemove={true} onRemoved={(text, tone) => { setNote({ text, tone }); setExtra([]); setMore(false); list.reload(); announceChange(); }} />
            ))}
          </ul>
        )}
        {next && (
          <Button variant="outline" onClick={showMore}>
            Show more
          </Button>
        )}
      </section>

      {list.data.organisationStops && list.data.organisationStops.length > 0 && (
        <section aria-label="Replied STOP" className="space-y-3">
          <h2>Replied STOP to your numbers</h2>
          <p className="text-sm text-muted-foreground">These people texted STOP. It applies across your workspace, and only they can lift it by replying START.</p>
          <ul className="pr-rows">
            {list.data.organisationStops.map((s) => (
              <li key={s.stopId} className="pr-row">
                <span className="pr-row-main">
                  <b>{s.addressHint}</b>
                  <span className="pr-row-sub">Replied STOP to {s.sendingNumberHint} on {formatDate(s.createdAt, { time: false })}</span>
                </span>
                <span className="pr-row-side">
                  <StatusPill tone="amber">They replied STOP</StatusPill>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Uses the signed recipient link from a message. */
export function UnsubscribePage({ title = "Stop hearing from us", link }: { title?: string; link?: string }) {
  const [state, setState] = useState<"idle" | "done" | { error: string }>("idle");
  if (!link) return <p>Open the unsubscribe link in your message to stop hearing from us.</p>;
  if (state === "done") return <p role="status">You are unsubscribed from emails from this app.</p>;
  return <form className="pr-card max-w-md space-y-4" aria-label={title} onSubmit={async (e) => {
    e.preventDefault();
    try { await send("/api/pramaan/consent/unsubscribe", { link }); setState("done"); }
    catch (err) { setState({ error: err instanceof Error ? err.message : "Try again later." }); }
  }}>
    <h2>{title}</h2><p>Stop emails to the recipient of this message.</p>
    {typeof state === "object" && <p role="alert">{state.error}</p>}
    <Button type="submit">Unsubscribe</Button>
  </form>;
}
