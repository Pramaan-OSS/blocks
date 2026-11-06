"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CopyReference } from "@/components/pramaan/fields";
import { type PillTone, StatusPill } from "@/components/pramaan/parts";
import { EmptyState, ErrorState, LoadingState } from "@/components/pramaan/states";
import { type ApiError, PRAMAAN_CHANGED, api, useResource } from "@/lib/pramaan/client";
import { actionName, formatDate, humanize } from "@/lib/pramaan/plain";
import type { ActivityPage, Call, CallStatus, DeliveryList } from "@/lib/pramaan/activity";

const STATUS: Record<CallStatus, { text: string; tone: PillTone }> = {
  done: { text: "Done", tone: "green" },
  failed: { text: "Failed", tone: "red" },
};

const DELIVERY: Record<string, { text: string; tone: PillTone }> = {
  delivered: { text: "Delivered", tone: "green" },
  failed: { text: "Failed", tone: "red" },
  retrying: { text: "Trying again", tone: "amber" },
};

interface Filters {
  capability: string;
  status: string;
  from: string;
  to: string;
}
const NONE: Filters = { capability: "", status: "", from: "", to: "" };

const query = (f: Filters, cursor?: string) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...f, cursor })) if (v) q.set(k, v);
  const s = q.toString();
  return `/api/pramaan/activity${s ? `?${s}` : ""}`;
};

/** One call: what ran, when, the cost, and for a failure what went wrong and what to do next. */
function CallDetail({ id }: { id: string }) {
  const c = useResource<Call>(`/api/pramaan/activity/${encodeURIComponent(id)}`);
  if (c.error && !c.data) return <ErrorState error={c.error} onRetry={c.reload} />;
  if (!c.data) return <LoadingState label="Loading this call" />;
  const d = c.data;
  const s = STATUS[d.status];
  return (
    <section aria-label="Call details" className="pr-card space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2>{actionName(d.capability)}</h2>
        <StatusPill tone={s.tone}>{s.text}</StatusPill>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">When</dt>
        <dd>{formatDate(d.created_at)}</dd>
        <dt className="text-muted-foreground">Reference</dt>
        <dd>
          <CopyReference value={d.call_id} />
        </dd>
      </dl>
      {d.error && (
        <div role="alert" className="space-y-2 rounded-md border border-destructive/50 p-3 text-sm">
          <p className="font-medium text-destructive">{d.error.message}</p>
          {d.error.next && (
            <p>
              <b>What to do next:</b> {d.error.next}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/** A list that grows by "Show more" and starts over when the filters change. */
function useActivity(f: Filters) {
  const [state, setState] = useState<{ page?: ActivityPage; rows: ActivityPage["results"]; cursor?: string; error?: ApiError; loading: boolean }>({ rows: [], loading: true });
  const [tick, setTick] = useState(0);
  const key = JSON.stringify(f);
  const load = useCallback(
    async (cursor?: string) => {
      setState((s) => ({ ...s, loading: true }));
      try {
        const page = await api<ActivityPage>(query(JSON.parse(key) as Filters, cursor));
        setState((s) => ({ page, rows: cursor ? ([...s.rows, ...page.results] as ActivityPage["results"]) : page.results, cursor: page.nextCursor, loading: false }));
      } catch (e) {
        setState((s) => ({ ...s, error: e as ApiError, loading: false }));
      }
    },
    [key],
  );
  useEffect(() => {
    void load();
    const again = () => setTick((t) => t + 1);
    window.addEventListener(PRAMAAN_CHANGED, again);
    return () => window.removeEventListener(PRAMAAN_CHANGED, again);
  }, [load, tick]);
  return { ...state, more: () => load(state.cursor), reload: () => load() };
}

function Calls() {
  const id = useId();
  const [draft, setDraft] = useState<Filters>(NONE);
  const [applied, setApplied] = useState<Filters>(NONE);
  const [selected, setSelected] = useState<string>();
  const a = useActivity(applied);

  const options = [...new Set(["web.search", "email.send", "llm.complete", "sms.send", "web.read", ...a.rows.map((r) => r.capability)])].sort((x, y) => actionName(x).localeCompare(actionName(y)));
  const set = (patch: Partial<Filters>) => setDraft({ ...draft, ...patch });

  return (
    <div className="space-y-4">
      <form
        role="search"
        aria-label="Filter activity"
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setSelected(undefined);
          setApplied(draft);
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-w`}>What ran</Label>
          <select id={`${id}-w`} className="pr-select" value={draft.capability} onChange={(e) => set({ capability: e.target.value })}>
            <option value="">Anything</option>
            {options.map((c) => (
              <option key={c} value={c}>
                {actionName(c)}
              </option>
            ))}
          </select>
        </div>
        {(
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-s`}>How it went</Label>
            <select id={`${id}-s`} className="pr-select" value={draft.status} onChange={(e) => set({ status: e.target.value })}>
              <option value="">Any</option>
              {(["done", "failed"] as CallStatus[]).map((k) => (
                <option key={k} value={k}>
                  {STATUS[k].text}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-f`}>From</Label>
          <Input id={`${id}-f`} type="date" value={draft.from} onChange={(e) => set({ from: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-t`}>To</Label>
          <Input id={`${id}-t`} type="date" value={draft.to} onChange={(e) => set({ to: e.target.value })} />
        </div>
        <Button type="submit" variant="outline">
          Apply
        </Button>
        <Button type="button" variant="outline" onClick={() => { setDraft(NONE); setApplied(NONE); setSelected(undefined); }}>
          Clear
        </Button>
      </form>

      {a.error && a.rows.length === 0 ? (
        <ErrorState error={a.error} onRetry={a.reload} />
      ) : a.loading && a.rows.length === 0 ? (
        <LoadingState label="Loading activity" />
      ) : a.rows.length === 0 ? (
        <EmptyState title="Nothing ran in this period">Calls show up here once your app uses Pramaan. Try a wider range.</EmptyState>
      ) : (
        <div className="grid gap-6 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <div className="space-y-3">
            <ul className="pr-rows" aria-label="Calls">
              {(a.rows as Call[]).map((c) => {
                const s = STATUS[c.status];
                return (
                  <li key={c.call_id}>
                    <button type="button" className="pr-row" aria-pressed={selected === c.call_id} onClick={() => setSelected(c.call_id)}>
                      <span className="pr-row-main">
                        <b>{actionName(c.capability)}</b>
                        <span className="pr-row-sub">
                          {formatDate(c.created_at)}

                        </span>
                      </span>
                      <span className="pr-row-side">
                        <StatusPill tone={s.tone}>{s.text}</StatusPill>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {a.cursor && (
              <Button variant="outline" disabled={a.loading} onClick={a.more}>
                Show more
              </Button>
            )}
          </div>
          <div>{selected ? <CallDetail key={selected} id={selected} /> : <EmptyState title="Choose a call">What happened, and what to do next if it failed, shows here.</EmptyState>}</div>
        </div>
      )}
    </div>
  );
}

function Deliveries({ data, onReplayed }: { data: DeliveryList; onReplayed: () => void }) {
  const [note, setNote] = useState<string>();
  if (data.results.length === 0) return <EmptyState title="No deliveries yet">Messages we send to your server show up here.</EmptyState>;
  return (
    <ul className="pr-rows" aria-label="Webhook deliveries">
      {note && <li role="status">{note}</li>}
      {data.results.map((d) => {
        const s = DELIVERY[d.status] ?? { text: humanize(d.status), tone: "grey" as const };
        return (
          <li key={d.delivery_id} className="pr-row">
            <span className="pr-row-main">
              <b>{humanize(d.event.replace(/[.]/g, " "))}</b>
              <span className="pr-row-sub">
                {formatDate(d.created_at)} · {d.attempts} {d.attempts === 1 ? "try" : "tries"}
                {d.response_status ? ` · your server answered ${d.response_status}` : ""}
              </span>
              {d.error && (
                <span className="pr-row-sub">
                  {d.error.message} {d.error.next && <b>What to do next: {d.error.next}</b>}
                </span>
              )}
            </span>
            <span className="pr-row-side">
              <StatusPill tone={s.tone}>{s.text}</StatusPill>
              {d.replayable && <Button variant="outline" onClick={async () => {
                try { await api(`/api/pramaan/activity/deliveries/${encodeURIComponent(d.delivery_id)}/replay`, { method: "POST" }); setNote("Replay queued."); onReplayed(); }
                catch (e) { setNote(e instanceof Error ? e.message : "Try again later."); }
              }}>Replay</Button>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Call and delivery history with filters and replay.
 */
export function ActivityLog() {
  const d = useResource<DeliveryList>("/api/pramaan/activity/deliveries");

  return (
    <Tabs defaultValue="calls">
      <TabsList>
        <TabsTrigger value="calls">Calls</TabsTrigger>
        <TabsTrigger value="deliveries">Webhook deliveries</TabsTrigger>
      </TabsList>
      <TabsContent value="calls" className="pt-4">
        <Calls />
      </TabsContent>
      {(
        <TabsContent value="deliveries" className="pt-4">
          {d.error ? <ErrorState error={d.error} onRetry={d.reload} /> : !d.data ? <LoadingState label="Loading deliveries" /> : <Deliveries data={d.data} onReplayed={d.reload} />}
        </TabsContent>
      )}
    </Tabs>
  );
}
