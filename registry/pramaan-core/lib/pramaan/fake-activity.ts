import type { FakeCtx, FakeState } from "./fake";

// Fake per-call rows and webhook deliveries: the activity log's routes. NOT in the real API yet
// GET /v1/calls, GET /v1/calls/{id} and GET /v1/webhook-deliveries are proposed shapes,
// served here so the block can be built and tested. The real API answers 404 for them today and
// the block falls back to the daily totals of GET /v1/usage.

const DAY = 86_400_000;

interface Call {
  call_id: string;
  capability: string;
  status: "done" | "failed" | "running" | "waiting_approval";
  charged_micro: number;
  created_at: number;
  error?: { code: string; message: string; next?: string };
}

interface Delivery {
  delivery_id: string;
  event: string;
  status: "delivered" | "failed" | "retrying";
  attempts: number;
  response_status?: number;
  created_at: number;
  error?: { message: string; next?: string };
}

export interface ActivityState {
  calls: Call[];
  deliveries: Delivery[];
}

const CAPS: [string, number][] = [["web.search", 5_000], ["email.send", 2_000], ["llm.complete", 12_000], ["sms.send", 9_100], ["web.read", 4_000]];
const ERRORS: Record<string, { code: string; message: string; next: string }> = {
  "email.send": { code: "connection_required", message: "Your Gmail connection has expired, so the email was not sent.", next: "Reconnect Gmail in Connections, then send it again." },
  "sms.send": { code: "opted_out", message: "This person opted out of text messages, so nothing was sent and nothing was charged.", next: "Remove them from your text list only if they asked to hear from you again." },
  "web.read": { code: "upstream_unavailable", message: "That page could not be reached.", next: "Check the address and try again in a minute." },
};

function seedActivity(s: FakeState): ActivityState {
  const now = s.now();
  const calls: Call[] = [];
  for (let i = 0; i < 40; i++) {
    const [capability, price] = CAPS[i % CAPS.length];
    const failed = i % 7 === 3 && ERRORS[capability] !== undefined;
    const status: Call["status"] = i === 0 ? "running" : i === 1 ? "waiting_approval" : failed ? "failed" : "done";
    calls.push({
      call_id: `call_fake${String(i + 1).padStart(4, "0")}`,
      capability,
      status,
      charged_micro: status === "done" ? price : 0,
      created_at: now - i * 7 * 3_600_000,
      ...(status === "failed" ? { error: ERRORS[capability] } : {}),
    });
  }
  const deliveries: Delivery[] = [
    { delivery_id: "whd_fake0001", event: "approval.decided", status: "delivered", attempts: 1, response_status: 200, created_at: now - 2 * 3_600_000 },
    { delivery_id: "whd_fake0002", event: "job.finished", status: "failed", attempts: 5, response_status: 500, created_at: now - DAY, error: { message: "Your server answered 500 five times, so we stopped trying.", next: "Fix the error on your server, then replay the event from your dashboard." } },
    { delivery_id: "whd_fake0003", event: "job.finished", status: "retrying", attempts: 2, response_status: 503, created_at: now - 20 * 60_000 },
    { delivery_id: "whd_fake0004", event: "approval.requested", status: "delivered", attempts: 1, response_status: 200, created_at: now - 3 * DAY },
  ];
  return { calls, deliveries };
}

export const activity = (s: FakeState): ActivityState => (s.activity ??= seedActivity(s));

const iso = (ms: number) => new Date(ms).toISOString();
const callView = (x: Call) => ({ ...x, created_at: iso(x.created_at) });
const day = (ms: number) => iso(ms).slice(0, 10);

/** The activity routes of this fake. Returns undefined for a route it doesn't serve. */
export function activityRoutes(c: FakeCtx): Response | undefined {
  if (c.method !== "GET") return undefined;
  const a = activity(c.s);
  const q = c.url.searchParams;
  if (c.path === "/v1/calls") {
    const from = q.get("from");
    const to = q.get("to");
    const rows = a.calls
      .filter((x) => (!q.get("capability") || x.capability === q.get("capability")) && (!q.get("status") || x.status === q.get("status")) && (!from || day(x.created_at) >= from) && (!to || day(x.created_at) <= to))
      .sort((x, y) => y.created_at - x.created_at);
    const limit = Math.min(100, Math.max(1, Number(q.get("limit")) || 20));
    const start = Number(q.get("cursor")) || 0;
    const next = start + limit;
    return c.json(200, { results: rows.slice(start, next).map(callView), ...(next < rows.length ? { next_cursor: String(next) } : {}) });
  }
  const m = c.path.match(/^\/v1\/calls\/([^/]+)$/);
  if (m) {
    const call = a.calls.find((x) => x.call_id === decodeURIComponent(m[1]));
    return call ? c.json(200, callView(call)) : c.fail(404, "not_found", "No call with that id. List them with GET /v1/calls.");
  }
  if (c.path === "/v1/webhook-deliveries")
    return c.json(200, { results: [...a.deliveries].sort((x, y) => y.created_at - x.created_at).map((d) => ({ ...d, created_at: iso(d.created_at) })) });
  return undefined;
}
