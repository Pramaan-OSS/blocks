import "server-only";
import { PramaanError } from "@pramaan/sdk";
import { pramaan } from "@/lib/pramaan/server";

// Call history and webhook delivery history use the public activity routes.

export type CallStatus = "done" | "failed";

export interface Call {
  /** The handle for one call. Never shown, only copied. */
  readonly call_id: string;
  readonly capability: string;
  readonly status: CallStatus;
  readonly charged_micro: number;
  readonly created_at: string;
  readonly error?: { readonly code: string; readonly message: string; readonly next?: string };
}

export type ActivityPage = { readonly mode: "calls"; readonly results: Call[]; readonly nextCursor?: string };

export interface Delivery {
  readonly delivery_id: string;
  readonly event: string;
  readonly status: "delivered" | "failed" | "retrying";
  readonly attempts: number;
  readonly replayable?: boolean;
  readonly response_status?: number;
  readonly created_at: string;
  readonly error?: { readonly message: string; readonly next?: string };
}

export interface DeliveryList {
  readonly available: true;
  readonly results: Delivery[];
}

const bad = (message: string) => new PramaanError("invalid_request", message, { status: 400 });
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const CAPABILITY = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const STATUSES: readonly string[] = ["done", "failed"];
const CALL_ID = /^[A-Za-z0-9_-]{1,128}$/;

export interface Filters {
  readonly capability?: string | null;
  readonly status?: string | null;
  readonly from?: string | null;
  readonly to?: string | null;
  readonly cursor?: string | null;
}

export async function listActivity(f: Filters, limit = 20): Promise<ActivityPage> {
  if (f.capability && !CAPABILITY.test(f.capability)) throw bad("Choose an action from the list.");
  if (f.status && !STATUSES.includes(f.status)) throw bad("Choose done or failed.");
  for (const d of [f.from, f.to]) if (d && !DAY.test(d)) throw bad("Dates look like 2026-10-31.");
  if (f.from && f.to && f.from > f.to) throw bad("The start date must come before the end date.");
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) q.set(k, v);
  if (f.status) q.set("status", f.status === "done" ? "ok" : f.status === "failed" ? "error" : f.status);
  if (f.from) q.set("from", `${f.from}T00:00:00.000Z`);
  if (f.to) q.set("to", `${f.to}T23:59:59.999Z`);
  q.set("limit", String(limit));
  const page = await pramaan<{ results: LiveCall[]; next_cursor?: string }>(`/v1/calls?${q}`);
  return { mode: "calls", results: page.results.map(callView), nextCursor: page.next_cursor };
}

interface LiveCall {
  id: string;
  capability: string;
  status: "ok" | "error";
  cost_micro: number;
  time: string;
  duration_ms: number;
  error: { code: string } | null;
}
const callView = (r: LiveCall): Call => ({
  call_id: r.id, capability: r.capability, status: r.status === "ok" ? "done" : "failed",
  charged_micro: r.cost_micro, created_at: r.time,
  ...(r.error ? { error: { code: r.error.code, message: "This call failed.", next: "Check your app settings before trying again." } } : {}),
});

/** Reads the call from the same public history; there is no single-call route. */
export async function getCall(id: string): Promise<Call> {
  if (!CALL_ID.test(id)) throw bad("That call isn't valid. Reload the list and try again.");
  // ponytail: looks through the latest 500 calls only; an older call reads as gone. Use a
  // single-call route here if the API adds one.
  let cursor: string | undefined;
  for (let pages = 0; pages < 5; pages++) {
    const page = await listActivity({ cursor }, 100);
    const found = page.results.find((r) => r.call_id === id);
    if (found) return found;
    cursor = page.nextCursor;
    if (!cursor) break;
  }
  throw new PramaanError("not_found", "This call is no longer in the history. Reload the list.", { status: 404 });
}

export async function listDeliveries(): Promise<DeliveryList> {
  const r = await pramaan<{ results: { id: string; event_type: string; attempt: number; status: "succeeded" | "failed"; response_status: number | null; time: string; replayable: boolean }[] }>("/v1/webhook-deliveries");
  return { available: true, results: r.results.map((d) => ({ delivery_id: d.id, event: d.event_type, attempts: d.attempt,
    status: d.status === "succeeded" ? "delivered" : "failed", response_status: d.response_status ?? undefined,
    created_at: d.time, replayable: d.replayable })) };
}

export function replayDelivery(id: string) {
  if (!CALL_ID.test(id)) throw bad("Choose a delivery from the list.");
  return pramaan<{ delivery_id: string; replay_of: string; status: "queued" }>(`/v1/webhook-deliveries/${encodeURIComponent(id)}/replay`, { method: "POST", body: {} });
}
