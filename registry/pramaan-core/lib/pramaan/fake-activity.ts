import type { FakeCtx, FakeState } from "./fake";

// Public activity route test doubles.

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
  replayTimes?: number[];
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
    const status: Call["status"] = failed ? "failed" : "done";
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
const callView = (x: Call) => ({ id: x.call_id, capability: x.capability, status: x.status === "done" ? "ok" : "error", cost_micro: x.charged_micro, time: iso(x.created_at), duration_ms: 100, error: x.error ? { code: x.error.code } : null });

/** The activity routes of this fake. Returns undefined for a route it doesn't serve. */
export function activityRoutes(c: FakeCtx): Response | undefined {
  const replay = c.path.match(/^\/v1\/webhook-deliveries\/([^/]+)\/replay$/);
  if (c.method === "POST" && replay) {
    const a = activity(c.s);
    const d = a.deliveries.find((x) => x.delivery_id === replay[1]);
    if (!d) return c.fail(404, "not_found", "Delivery not found.");
    if (c.now - d.created_at > 30 * DAY) return c.fail(409, "conflict", "This delivery is too old to replay.");
    a.replayTimes = (a.replayTimes ?? []).filter((t) => c.now - t < 60_000);
    if (a.replayTimes.length >= 10) return c.fail(429, "rate_limited", "Wait a minute before replaying again.");
    a.replayTimes.push(c.now);
    const id = `replay_${a.deliveries.length}`;
    a.deliveries.push({ ...d, delivery_id: id, created_at: c.now });
    return c.json(202, { delivery_id: id, replay_of: d.delivery_id, status: "queued" });
  }
  if (c.method !== "GET") return undefined;
  const a = activity(c.s);
  const q = c.url.searchParams;
  if (c.path === "/v1/calls") {
    const from = q.get("from");
    const to = q.get("to");
    const rows = a.calls
      .filter((x) => (!q.get("capability") || x.capability === q.get("capability")) && (!q.get("status") || (x.status === "done" ? "ok" : "error") === q.get("status")) && (!from || iso(x.created_at) >= from) && (!to || iso(x.created_at) <= to))
      .sort((x, y) => y.created_at - x.created_at);
    const limit = Math.min(100, Math.max(1, Number(q.get("limit")) || 20));
    const rawCursor = q.get("cursor");
    let start = 0;
    if (rawCursor) {
      try { const [time, id] = JSON.parse(Buffer.from(rawCursor, "base64url").toString()); start = rows.findIndex((x) => iso(x.created_at) === time && x.call_id === id) + 1; if (!start) throw new Error(); }
      catch { return c.fail(400, "invalid_request", "Use the next_cursor from this call list."); }
    }
    const next = start + limit;
    return c.json(200, { results: rows.slice(start, next).map(callView), ...(next < rows.length ? { next_cursor: Buffer.from(JSON.stringify([iso(rows[next - 1].created_at), rows[next - 1].call_id])).toString("base64url") } : {}) });
  }
  if (c.path === "/v1/webhook-deliveries")
    return c.json(200, { results: [...a.deliveries].sort((x, y) => y.created_at - x.created_at).map((d) => ({ id: d.delivery_id, endpoint_id: "endpoint_demo", event_id: `event_${d.delivery_id}`, event_type: d.event, attempt: d.attempts, status: d.status === "delivered" ? "succeeded" : "failed", response_status: d.response_status ?? null, time: iso(d.created_at), replay_of: null, replayable: c.now - d.created_at <= 30 * DAY })) });
  return undefined;
}
