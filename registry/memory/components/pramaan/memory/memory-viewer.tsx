"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConfirmAction } from "@/components/pramaan/confirm-action";
import { StatusPill } from "@/components/pramaan/parts";
import { EmptyState, ErrorState, LoadingState, StatusMessage, type StatusTone } from "@/components/pramaan/states";
import { ApiError, PRAMAAN_CHANGED, announceChange, api, useResource } from "@/lib/pramaan/client";
import { formatDate } from "@/lib/pramaan/plain";
import type { Change, Memory, MemoryPage, OrgQueue } from "@/lib/pramaan/memory";

const send = <T,>(url: string, method: string, body?: unknown) =>
  api<T>(url, { method, ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });

const WAITING = "sent for approval. Decide it in the approvals inbox; it is erased once it is approved.";

/** A list that grows by "Show more": loads `url`, follows `nextCursor`, and reloads when Pramaan data changes. */
function usePaged<T extends { ref?: string }>(url: string) {
  const [rows, setRows] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [error, setError] = useState<ApiError>();
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const load = useCallback(
    async (after?: string) => {
      setLoading(true);
      try {
        const join = url.includes("?") ? "&" : "?";
        const page = await api<{ results: T[]; nextCursor?: string }>(after ? `${url}${join}cursor=${encodeURIComponent(after)}` : url);
        setRows((old) => (after ? [...old, ...page.results] : page.results));
        setCursor(page.nextCursor);
        setError(undefined);
      } catch (e) {
        setError(e as ApiError);
      } finally {
        setLoading(false);
      }
    },
    [url],
  );
  useEffect(() => {
    void load();
    const again = () => setTick((t) => t + 1);
    window.addEventListener(PRAMAAN_CHANGED, again);
    return () => window.removeEventListener(PRAMAAN_CHANGED, again);
  }, [load, tick]);
  return { rows, cursor, error, loading, more: () => load(cursor), reload: () => load(), drop: (ref: string) => setRows((r) => r.filter((x) => x.ref !== ref)) };
}

function MyMemories({ approvalsHref }: { approvalsHref: string }) {
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  const list = usePaged<Memory>(`/api/pramaan/memory${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  const [note, setNote] = useState<{ text: string; tone: StatusTone }>();
  const [waiting, setWaiting] = useState<Set<string>>(new Set());
  const fail = (e: unknown) => setNote({ text: e instanceof ApiError ? e.message : "Something went wrong. Try again.", tone: "error" });

  async function remove(m: Memory) {
    try {
      const res = await send<{ status: string }>(`/api/pramaan/memory/${encodeURIComponent(m.ref)}`, "DELETE");
      if (res.status === "waiting_for_approval") {
        setWaiting((w) => new Set(w).add(m.ref));
        setNote({ text: `Deleting this memory was ${WAITING}`, tone: "info" });
      } else {
        list.drop(m.ref);
        setNote({ text: "Memory deleted.", tone: "success" });
      }
      announceChange();
    } catch (e) {
      fail(e);
    }
  }

  async function forget() {
    try {
      const res = await send<{ status: string; count?: number }>("/api/pramaan/memory/forget", "POST");
      setNote(res.status === "waiting_for_approval" ? { text: `Forgetting everything was ${WAITING}`, tone: "info" } : { text: "Everything was forgotten.", tone: "success" });
      if (res.status !== "waiting_for_approval") list.reload();
      else setWaiting(new Set(list.rows.map((r) => r.ref)));
      announceChange();
    } catch (e) {
      fail(e);
    }
  }

  return (
    <div className="space-y-4">
      <form
        className="flex flex-wrap items-end gap-2"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(typed.trim());
        }}
      >
        <div className="min-w-56 flex-1 space-y-1.5">
          <Label htmlFor="memory-search">Search what is remembered</Label>
          <Input id="memory-search" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="For example: food, travel, tone" />
        </div>
        <Button type="submit" variant="outline">
          Search
        </Button>
        {q && (
          <Button type="button" variant="outline" onClick={() => { setTyped(""); setQ(""); }}>
            Show all
          </Button>
        )}
      </form>

      <StatusMessage text={note?.text} tone={note?.tone} />
      {note?.text.includes("approval") && (
        <a className="text-sm underline" href={approvalsHref}>
          Open the approvals inbox
        </a>
      )}

      {list.error && list.rows.length === 0 ? (
        <ErrorState error={list.error} onRetry={list.reload} />
      ) : list.loading && list.rows.length === 0 ? (
        <LoadingState label="Loading memories" />
      ) : list.rows.length === 0 ? (
        q ? (
          <EmptyState title="Nothing matches">Try other words, or show everything that is remembered.</EmptyState>
        ) : (
          <EmptyState title="Nothing is remembered yet">
            Memories build up from your chats. Deleting a chat also deletes the memories that came from it.
          </EmptyState>
        )
      ) : (
        <>
          <ul className="pr-rows" aria-label="Memories">
            {list.rows.map((m) => (
              <li key={m.ref} className="pr-row">
                <span className="pr-row-main">
                  <b>{m.text}</b>
                  {m.createdAt && <span className="pr-row-sub">Remembered {formatDate(m.createdAt, { time: false })}</span>}
                </span>
                <span className="pr-row-side">
                  {waiting.has(m.ref) ? (
                    <StatusPill tone="amber">Waiting for approval</StatusPill>
                  ) : (
                    <ConfirmAction
                      label="Delete"
                      title="Delete this memory?"
                      description="It is erased for good and can't be brought back. Deleting needs approval, so the request goes to the approvals inbox first."
                      details={<p aria-label="Memory to delete" className="pr-sunk text-sm">{m.text}</p>}
                      confirmLabel="Delete"
                      variant="outline"
                      onConfirm={() => remove(m)}
                    />
                  )}
                </span>
              </li>
            ))}
          </ul>
          {list.cursor && (
            <Button variant="outline" disabled={list.loading} onClick={list.more}>
              Show more
            </Button>
          )}
          <div className="flex items-center justify-between gap-3 border-t pt-4">
            <p className="text-sm text-muted-foreground">Want a clean slate? This erases everything remembered about you.</p>
            <ConfirmAction
              label="Forget everything"
              title="Forget everything?"
              description="Every memory about you is erased for good. This needs approval, so the request goes to the approvals inbox first."
              confirmLabel="Forget everything"
              variant="destructive"
              onConfirm={forget}
            />
          </div>
        </>
      )}
    </div>
  );
}

const EVENT: Record<Change["event"], string> = { add: "Remembered", update: "Updated", delete: "Forgotten" };
const EVENT_TONE = { add: "green", update: "blue", delete: "grey" } as const;

function Changes() {
  const list = usePaged<Change>("/api/pramaan/memory/changes");
  if (list.error && list.rows.length === 0) return <ErrorState error={list.error} onRetry={list.reload} />;
  if (list.loading && list.rows.length === 0) return <LoadingState label="Loading changes" />;
  if (list.rows.length === 0) return <EmptyState title="No changes yet">What gets remembered or forgotten is listed here.</EmptyState>;
  return (
    <div className="space-y-4">
      <ul className="pr-rows" aria-label="Recent changes">
        {list.rows.map((c, i) => (
          <li key={`${c.ref}-${i}`} className="pr-row">
            <span className="pr-row-main">
              <b>{c.text ?? "A memory"}</b>
              {c.createdAt && <span className="pr-row-sub">{formatDate(c.createdAt)}</span>}
            </span>
            <span className="pr-row-side">
              <StatusPill tone={EVENT_TONE[c.event]}>{EVENT[c.event]}</StatusPill>
            </span>
          </li>
        ))}
      </ul>
      {list.cursor && (
        <Button variant="outline" disabled={list.loading} onClick={list.more}>
          Show more
        </Button>
      )}
    </div>
  );
}

function Organisation() {
  const q = useResource<OrgQueue>("/api/pramaan/memory/org");
  const [note, setNote] = useState<{ text: string; tone: StatusTone }>();
  if (q.error && !q.data) return <ErrorState error={q.error} onRetry={q.reload} />;
  if (!q.data) return <LoadingState label="Loading organisation memories" />;
  if (!q.data.admin) return <EmptyState title="Only admins review these">Organisation memories are shared facts about how your team works. A workspace admin approves them.</EmptyState>;

  async function decide(id: string, action: "approve" | "reject" | "remove" | "acknowledge", done: string) {
    try {
      await send("/api/pramaan/memory/org/decide", "POST", { id, action });
      setNote({ text: done, tone: "success" });
      q.reload();
    } catch (e) {
      setNote({ text: e instanceof ApiError ? e.message : "Something went wrong. Try again.", tone: "error" });
    }
  }

  const { rows, notices } = q.data;
  return (
    <div className="space-y-6">
      <StatusMessage text={note?.text} tone={note?.tone} />
      <section aria-label="Waiting for review" className="space-y-2">
        <h3>Waiting for your review</h3>
        {rows.length === 0 ? (
          <EmptyState title="Nothing to review">Facts the assistant suggests for the whole team show up here.</EmptyState>
        ) : (
          <ul className="pr-rows">
            {rows.map((r) => (
              <li key={r.id} className="pr-row">
                <span className="pr-row-main">
                  <b>{r.text}</b>
                  <span className="pr-row-sub">{r.conflict ? "This may contradict something the team already remembers." : "Suggested for the whole team."}</span>
                </span>
                <span className="pr-row-side">
                  {r.conflict && <StatusPill tone="amber">Check first</StatusPill>}
                  <ConfirmAction
                    label="Approve"
                    title="Share this with the whole team?"
                    description="Everyone's assistant will remember it."
                    details={<p className="pr-sunk text-sm">{r.text}</p>}
                    confirmLabel="Approve"
                    onConfirm={() => decide(r.id, "approve", "Approved. The team will remember it.")}
                  />
                  <Button variant="outline" aria-label={`Reject: ${r.text}`} onClick={() => decide(r.id, "reject", "Rejected. It won't be shared.")}>
                    Reject
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {notices.length > 0 && (
        <section aria-label="Added automatically" className="space-y-2">
          <h3>Added automatically</h3>
          <ul className="pr-rows">
            {notices.map((n) => (
              <li key={n.id} className="pr-row">
                <span className="pr-row-main">
                  <b>{n.text}</b>
                  <span className="pr-row-sub">Shared with the team{n.promotedAt ? ` on ${formatDate(n.promotedAt, { time: false })}` : ""} because several people said the same thing.</span>
                </span>
                <span className="pr-row-side">
                  <Button variant="outline" aria-label={`Got it: ${n.text}`} onClick={() => decide(n.id, "acknowledge", "Noted.")}>
                    Got it
                  </Button>
                  <ConfirmAction
                    label="Remove"
                    title="Remove this from the team's memory?"
                    description="The assistant stops using it for everyone."
                    details={<p className="pr-sunk text-sm">{n.text}</p>}
                    confirmLabel="Remove"
                    variant="destructive"
                    onConfirm={() => decide(n.id, "remove", "Removed from the team's memory.")}
                  />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/**
 * "What the assistant remembers": your own memories (search, delete one, forget everything), what
 * changed lately, and, for workspace admins, the organisation memories waiting for review.
 * Whose memories show is always the signed-in person; an admin never sees another member's.
 * Deleting needs a yes, so it goes to your approvals inbox (`approvalsHref`) first.
 */
export function MemoryViewer({ approvalsHref = "/" }: { approvalsHref?: string }) {
  return (
    <Tabs defaultValue="mine">
      <TabsList>
        <TabsTrigger value="mine">My memories</TabsTrigger>
        <TabsTrigger value="changes">Recent changes</TabsTrigger>
        <TabsTrigger value="org">Organisation</TabsTrigger>
      </TabsList>
      <TabsContent value="mine" className="pt-4">
        <MyMemories approvalsHref={approvalsHref} />
      </TabsContent>
      <TabsContent value="changes" className="pt-4">
        <Changes />
      </TabsContent>
      <TabsContent value="org" className="pt-4">
        <Organisation />
      </TabsContent>
    </Tabs>
  );
}
