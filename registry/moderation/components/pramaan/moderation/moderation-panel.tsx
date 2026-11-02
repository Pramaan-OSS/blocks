"use client";
import { useState, type FormEvent } from "react";
import { api, useResource } from "@/lib/pramaan/client";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/pramaan/parts";
import { formatDate } from "@/lib/pramaan/plain";
import type { ModerationData } from "@/lib/pramaan/moderation";
const field = "block w-full rounded border bg-background p-2";
/** The host supplies references; people see a descriptive label instead. */
export function SafetyActions({ kind, target, label, getBotCheckToken }: { kind: "item" | "person"; target: string; label: string; getBotCheckToken?: () => Promise<string> }) {
  const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  async function act(action: string, reason?: string) {
    if (busy) return; setBusy(true);
    try {
      const response = await api<{ message: string }>("/api/pramaan/moderation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, kind, ref: target, reason, botCheckToken: await getBotCheckToken?.() }) });
      setMessage(response.message);
    } catch (e) { setMessage(e instanceof Error ? e.message : "Couldn't finish that. Try again."); }
    finally { setBusy(false); }
  }
  function report(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void act("report", String(new FormData(event.currentTarget).get("reason"))); }
  return <section aria-label={`Safety for ${label}`} className="space-y-3 rounded border p-4">
    <h2 className="font-serif text-xl">{label}</h2>
    <form onSubmit={report} className="space-y-3"><label className="block">Reason<textarea required maxLength={1000} name="reason" className={field} disabled={busy} /></label><Button variant="outline" disabled={busy}>Report {kind}</Button></form>
    {kind === "person" && <div className="flex gap-2"><Button variant="outline" disabled={busy} onClick={() => void act("block")}>Block person</Button><Button variant="outline" disabled={busy} onClick={() => void act("unblock")}>Unblock person</Button></div>}
    <p role="status" aria-live="polite">{message}</p>
  </section>;
}
export function ModerationPanel({ getBotCheckToken }: { getBotCheckToken?: () => Promise<string> } = {}) {
  const { data, error, loading, reload } = useResource<ModerationData>("/api/pramaan/moderation");
  const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  async function decide(id: string, action: string) {
    if (busy) return; setBusy(true);
    try {
      await api("/api/pramaan/moderation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action, botCheckToken: await getBotCheckToken?.() }) });
      reload(); setMessage("Review saved.");
    } catch (e) { setMessage(e instanceof Error ? e.message : "Couldn't save this review."); }
    finally { setBusy(false); }
  }
  if (loading) return <p role="status">Loading reports…</p>;
  if (error) return <div role="alert">{error.message} <Button variant="outline" onClick={reload}>Try again</Button></div>;
  return <section aria-label="Moderator queue" className="space-y-4">
    <h2 className="font-serif text-2xl">Reports</h2><p>Owners and admins can review reports. A text check never removes content.</p>
    {!data?.reports.length && <p>No reports to review.</p>}
    <ul className="divide-y">{data?.reports.map((r, i) => <li key={r.id} className="space-y-2 py-4">
      <h3 className="font-semibold">{r.kind === "item" ? "Item" : "Person"} report {i + 1}</h3><p>{r.reason}</p>
      {r.subject && <div><p className="font-medium">{r.subject.label}</p>{r.subject.excerpt && <p>{r.subject.excerpt}</p>}{r.subject.href?.startsWith("/profiles/") && <a className="underline" href={r.subject.href}>View profile</a>}</div>}
      <p className="text-sm text-muted-foreground">{r.automatic ? "Automatic check" : "Community member"} · {formatDate(r.at, { time: true })}</p>
      <StatusPill tone={r.status === "open" ? "amber" : "grey"}>{r.status === "open" ? "Needs review" : r.status === "hidden" ? "Hidden" : "Dismissed"}</StatusPill>
      {r.decidedAt && <p>Reviewed by {r.reviewer ?? "a moderator"} · {formatDate(r.decidedAt, { time: true })}</p>}
      {r.status === "open" && <div className="flex gap-2">{r.kind === "item" && <Button disabled={busy} onClick={() => void decide(r.id, "hide")}>Hide item</Button>}<Button variant="outline" disabled={busy} onClick={() => void decide(r.id, "dismiss")}>Dismiss report</Button></div>}
    </li>)}</ul><p role="status" aria-live="polite">{message}</p>
  </section>;
}
