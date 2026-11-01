import "server-only";
import { PramaanError } from "@pramaan/sdk";
import { pramaan } from "@/lib/pramaan/server";

// Server half of the activity log: what ran, what it cost, and what failed with its next step.
//
// Per-call rows and webhook deliveries are not in the Pramaan API yet. The block asks for them
// (GET /v1/calls, GET /v1/calls/{id}, GET /v1/webhook-deliveries) and, when the API answers 404,
// falls back to the daily totals of GET /v1/usage, and hides the deliveries tab. When Pramaan adds
// the routes, the screen starts showing them with no change here.

export type CallStatus = "done" | "failed" | "running" | "waiting_approval";

export interface Call {
  /** The handle for one call. Never shown, only copied. */
  readonly call_id: string;
  readonly capability: string;
  readonly status: CallStatus;
  readonly charged_micro: number;
  readonly created_at: string;
  readonly error?: { readonly code: string; readonly message: string; readonly next?: string };
}

export interface DayRow {
  readonly day: string;
  readonly capability: string;
  readonly calls: number;
  readonly spend_micro: number;
}

export type ActivityPage =
  | { readonly mode: "calls"; readonly results: Call[]; readonly nextCursor?: string }
  | { readonly mode: "daily"; readonly results: DayRow[]; readonly nextCursor?: undefined };

export interface Delivery {
  readonly delivery_id: string;
  readonly event: string;
  readonly status: "delivered" | "failed" | "retrying";
  readonly attempts: number;
  readonly response_status?: number;
  readonly created_at: string;
  readonly error?: { readonly message: string; readonly next?: string };
}

export interface DeliveryList {
  /** False when the API has no delivery history: the tab is hidden. */
  readonly available: boolean;
  readonly results: Delivery[];
}

const bad = (message: string) => new PramaanError("invalid_request", message, { status: 400 });
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const CAPABILITY = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const STATUSES: readonly string[] = ["done", "failed", "running", "waiting_approval"];
const CALL_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** A route the API doesn't have yet answers 404 with no body of its own. */
const missing = (e: unknown) => e instanceof PramaanError && e.status === 404;

export interface Filters {
  readonly capability?: string | null;
  readonly status?: string | null;
  readonly from?: string | null;
  readonly to?: string | null;
  readonly cursor?: string | null;
}

export async function listActivity(f: Filters): Promise<ActivityPage> {
  if (f.capability && !CAPABILITY.test(f.capability)) throw bad("Choose an action from the list.");
  if (f.status && !STATUSES.includes(f.status)) throw bad("Choose done, failed, running or waiting for a yes.");
  for (const d of [f.from, f.to]) if (d && !DAY.test(d)) throw bad("Dates look like 2026-10-31.");
  if (f.from && f.to && f.from > f.to) throw bad("The start date must come before the end date.");
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) q.set(k, v);
  q.set("limit", "20");
  try {
    const page = await pramaan<{ results: Call[]; next_cursor?: string }>(`/v1/calls?${q}`);
    return { mode: "calls", results: page.results, ...(page.next_cursor ? { nextCursor: page.next_cursor } : {}) };
  } catch (e) {
    if (!missing(e)) throw e;
  }
  // Daily totals: per day and action, the only history the API keeps today. They can't show status.
  const to = f.to || new Date().toISOString().slice(0, 10);
  const from = f.from || new Date(Date.parse(`${to}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);
  const usage = await pramaan<{ results: DayRow[] }>(`/v1/usage?from=${from}&to=${to}`);
  const rows = usage.results.filter((r) => !f.capability || r.capability === f.capability).sort((a, b) => b.day.localeCompare(a.day) || a.capability.localeCompare(b.capability));
  return { mode: "daily", results: rows };
}

export function getCall(id: string): Promise<Call> {
  if (!CALL_ID.test(id)) throw bad("That call isn't valid. Reload the list and try again.");
  return pramaan<Call>(`/v1/calls/${encodeURIComponent(id)}`);
}

export async function listDeliveries(): Promise<DeliveryList> {
  try {
    const r = await pramaan<{ results: Delivery[] }>("/v1/webhook-deliveries");
    return { available: true, results: r.results };
  } catch (e) {
    if (missing(e)) return { available: false, results: [] };
    throw e;
  }
}
