import type { FakeCtx, FakeState } from "./fake";

// Fake outcomes ("missions"), jobs, wallet, usage, accounts and app connections: the platform routes
// the mission runner, wallet and connections blocks use, with the documented shapes. Extends the
// core fake (fake.ts); it keeps its own state under `s.platform`.
//
// Not in the OpenAPI yet: `progress` on a running outcome job (step statuses and the
// charge so far), and the exact answer of a step that waits for a member's approval.

const DAY = 86_400_000;

export interface FakeStep {
  id: string;
  label: string;
  capability: string;
  effect_class: string;
  required: true;
  max_calls: 1;
  requires_approval: boolean;
  price_max_micro: number;
  mode: "sync";
  needs_connection: false;
}

interface Mission {
  id: string;
  description: string;
  effect_class: string;
  input_schema: Record<string, unknown>;
  check(input: Record<string, unknown>): string | undefined;
  steps: FakeStep[];
  result(input: Record<string, unknown>): unknown;
}

const step = (id: string, label: string, capability: string, price: number, approval = false, effect = "read_only"): FakeStep => ({
  id,
  label,
  capability,
  effect_class: effect,
  required: true,
  max_calls: 1,
  requires_approval: approval,
  price_max_micro: price,
  mode: "sync",
  needs_connection: false,
});

const MISSIONS: Mission[] = [
  {
    id: "company.research",
    description: "One sourced profile of a company from its domain or name: register record, news, site pages, social page, and a written summary.",
    effect_class: "read_only",
    input_schema: {
      type: "object",
      properties: {
        domain: { type: "string", maxLength: 2048, description: "Company website domain, e.g. example.com. Send this or name." },
        name: { type: "string", minLength: 1, maxLength: 200, description: "Company name. Send this or domain." },
      },
    },
    check: (i) => (i.domain || i.name ? undefined : "Send a domain or a name for the company."),
    steps: [
      step("register", "Look up the company register", "companies.registry.search", 20_000),
      step("news", "Collect recent news", "companies.news", 50_000),
      step("site", "Read the company's site", "web.read", 40_000),
      step("summary", "Write the summary", "llm.complete", 100_000),
    ],
    result: (i) => ({ company: i.name ?? i.domain, summary: `A sourced profile of ${String(i.name ?? i.domain)}.`, sources: 4 }),
  },
  {
    id: "broadcast.send",
    description: "Draft a broadcast to subscribed contacts, show the recipient count, the opted-out removed and the message, and send it after approval.",
    effect_class: "external_irreversible",
    input_schema: {
      type: "object",
      required: ["accountId", "name", "text"],
      properties: {
        accountId: { type: "string", minLength: 1, maxLength: 128, description: "The connected messaging account to send from." },
        name: { type: "string", minLength: 1, maxLength: 256, description: "A name for the broadcast, for your own reference." },
        text: { type: "string", minLength: 1, maxLength: 4096, description: "The message, exactly as it will be sent to every recipient." },
        tag: { type: "string", minLength: 1, maxLength: 128, description: "Only contacts with this tag." },
      },
    },
    check: (i) => (i.accountId && i.name && i.text ? undefined : "Send accountId, name and text."),
    steps: [
      step("contacts", "List the subscribed contacts", "outreach.contacts.list", 5_000),
      step("draft", "Create the broadcast", "outreach.broadcast.create", 5_000),
      step("send", "Send it", "outreach.broadcast.send", 90_000, true, "external_irreversible"),
    ],
    result: (i) => ({ broadcast: i.name, recipients: 42, optedOutRemoved: 3 }),
  },
];

const priceOf = (m: Mission) => m.steps.reduce((n, x) => n + x.price_max_micro, 0);
const requiresApproval = (m: Mission) => m.steps.some((x) => x.requires_approval);

function planOf(m: Mission, input: unknown): string {
  let h = 5381;
  for (const ch of `${m.id}:${JSON.stringify(input)}`) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
  return `plan_${h.toString(16)}`;
}

interface Job {
  id: string;
  mission: Mission;
  input: Record<string, unknown>;
  plan: string;
  holdMicro: number;
  createdAt: number;
  updatedAt: number;
  status: "running" | "done" | "failed" | "cancelled";
  idx: number;
  /** When the step before this one ended (or the run started). */
  cursorAt: number;
  stepStart?: number;
  done: string[];
  charged: number;
  approvals: Record<string, string>;
  error?: { code: string; message: string };
  waiting?: string;
  settled: boolean;
}

interface Conn {
  connectionId: string;
  app: string;
  status: "active" | "pending" | "failed" | "expired" | "disabled" | "revoked";
  name?: string;
  connectedAt: string;
  access: "read" | "read-write" | "full" | "limited";
  deleteApproval?: string;
}

interface UsageRow {
  day: string;
  capability: string;
  calls: number;
  spend_micro: number;
}

export interface PlatformState {
  jobs: Map<string, Job>;
  idem: Map<string, string>;
  balanceMicro: number;
  usage: UsageRow[];
  connections: Map<string, Conn[]>;
  seq: number;
}

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function seedPlatform(s: FakeState): PlatformState {
  const now = s.now();
  const usage: UsageRow[] = [];
  const caps: [string, number][] = [["email.send", 2_000], ["llm.complete", 12_000], ["web.read", 4_000], ["companies.news", 50_000]];
  for (let d = 0; d < 14; d++)
    caps.forEach(([capability, price], k) => {
      const calls = 3 + ((d * 7 + k * 5) % 9);
      usage.push({ day: dayOf(now - d * DAY), capability, calls, spend_micro: calls * price });
    });
  const at = (ago: number) => new Date(now - ago * DAY).toISOString();
  const connections = new Map<string, Conn[]>([
    [
      "user-42",
      [
        { connectionId: "apn_gmail1", app: "gmail", status: "active", name: "pat@example.com", connectedAt: at(30), access: "read-write" },
        { connectionId: "apn_cal1", app: "googlecalendar", status: "expired", name: "pat@example.com", connectedAt: at(90), access: "read" },
        { connectionId: "apn_gh1", app: "github", status: "revoked", connectedAt: at(200), access: "full" },
      ],
    ],
  ]);
  return { jobs: new Map(), idem: new Map(), balanceMicro: 12_340_000, usage, connections, seq: 0 };
}

export const platform = (s: FakeState): PlatformState => (s.platform ??= seedPlatform(s));

const held = (s: FakeState) => [...s.holds.values()].reduce((n, x) => n + x, 0);

function topUp(c: FakeCtx, required: number) {
  const available = platform(c.s).balanceMicro - held(c.s);
  return {
    message: `This needs up to $${(required / 1e6).toFixed(2)} and your balance is $${(available / 1e6).toFixed(2)}. Add credit, then try again.`,
    links: [{ label: "Add credit", url: "https://app.pramaan.dev/settings/wallet" }],
    required_micro: required,
    balance_micro: available,
  };
}

function addUsage(p: PlatformState, day: string, capability: string, spend: number) {
  const row = p.usage.find((r) => r.day === day && r.capability === capability);
  if (row) {
    row.calls++;
    row.spend_micro += spend;
  } else p.usage.push({ day, capability, calls: 1, spend_micro: spend });
}

/** Charges what a finished job did and releases its hold. Runs once. */
function settle(c: FakeCtx, j: Job) {
  if (j.settled) return;
  j.settled = true;
  c.s.holds.delete(`job:${j.id}`);
  const p = platform(c.s);
  p.balanceMicro -= j.charged;
  for (const id of j.done) {
    const st = j.mission.steps.find((x) => x.id === id)!;
    addUsage(p, dayOf(j.updatedAt), st.capability, st.price_max_micro);
  }
}

function fail(c: FakeCtx, j: Job, code: string, message: string) {
  j.status = "failed";
  j.error = { code, message };
  j.updatedAt = c.now;
  settle(c, j);
}

/** Moves a running job forward to `now`: each step takes `stepMs`; an approval step waits for a member. */
function advance(c: FakeCtx, j: Job) {
  while (j.status === "running") {
    const st = j.mission.steps[j.idx];
    if (!st) {
      j.status = "done";
      j.updatedAt = j.cursorAt;
      settle(c, j);
      return;
    }
    if (st.requires_approval && j.stepStart === undefined) {
      const id = (j.approvals[st.id] ??= c.addApproval({
        capability: st.capability,
        priceMicro: st.price_max_micro,
        input: j.input,
        requestedBy: { kind: "key" },
        createdAt: c.now,
      }));
      const a = c.s.approvals.get(id)!;
      if (a.status === "pending") {
        j.waiting = st.id;
        return;
      }
      j.waiting = undefined;
      if (a.status !== "approved") return fail(c, j, "forbidden", "A member declined this step, so it did not run and nothing more was charged.");
      j.stepStart = a.decidedAt ?? c.now;
    }
    j.stepStart ??= j.cursorAt;
    if (c.now < j.stepStart + c.s.stepMs) return;
    j.done.push(st.id);
    j.charged += st.price_max_micro;
    j.cursorAt = j.stepStart + c.s.stepMs;
    j.stepStart = undefined;
    j.idx++;
  }
}

function report(j: Job) {
  const done = j.mission.steps.filter((x) => j.done.includes(x.id));
  return {
    outcome: j.mission.id,
    version: 1,
    plan: j.plan,
    status: j.status === "done" ? "done" : "failed",
    ...(j.status === "done" ? { result: j.mission.result(j.input) } : {}),
    evidence: [],
    missing: [],
    steps: done.map((x) => ({ id: x.id, status: "ok", calls: 1, capability: x.capability, effect_class: x.effect_class, effect: x.effect_class === "read_only" ? "none" : "done" })),
    cost: {
      hold_micro: j.holdMicro,
      charged_micro: j.charged,
      capabilities: done.map((x) => ({ id: x.capability, calls: 1, charged_micro: x.price_max_micro })),
    },
  };
}

function jobView(c: FakeCtx, j: Job) {
  advance(c, j);
  const running = j.status === "running";
  const steps = j.mission.steps.map((x, i) => {
    let status: string;
    if (j.done.includes(x.id)) status = "done";
    else if (j.status === "failed" && i === j.idx) status = "failed";
    else if (j.status === "cancelled" || j.status === "failed") status = "skipped";
    else if (i === j.idx) status = j.waiting === x.id ? "waiting_approval" : "running";
    else status = "waiting";
    return { id: x.id, label: x.label, status, ...(j.approvals[x.id] ? { approval_id: j.approvals[x.id] } : {}) };
  });
  return {
    job_id: j.id,
    capability: j.mission.id,
    status: j.status,
    ...(running ? {} : { result: report(j) }),
    ...(j.error ? { error: { ...j.error, effect: "none" } } : {}),
    progress: { steps, charged_micro: j.charged },
    created_at: new Date(j.createdAt).toISOString(),
    updated_at: new Date(j.updatedAt).toISOString(),
  };
}

const info = (m: Mission) => ({
  id: m.id,
  description: m.description,
  version: 1,
  effect_class: m.effect_class,
  mode: "async",
  price_max_micro: priceOf(m),
  personal_data: false,
  available: true,
  ...(requiresApproval(m) ? { requires_approval: true } : {}),
  capability_ids: m.steps.map((x) => x.capability),
});

function connView(c: Conn) {
  return { connectionId: c.connectionId, app: c.app, status: c.status, ...(c.name ? { name: c.name } : {}), connectedAt: c.connectedAt };
}

function userConns(c: FakeCtx, user: string): Conn[] {
  const p = platform(c.s);
  const list = p.connections.get(user) ?? [];
  p.connections.set(user, list);
  // A delete waits for a member's approval; apply it once it is approved.
  for (const conn of [...list]) {
    const a = conn.deleteApproval ? c.s.approvals.get(conn.deleteApproval) : undefined;
    if (a?.status === "approved") list.splice(list.indexOf(conn), 1);
    else if (a && a.status !== "pending") conn.deleteApproval = undefined;
  }
  return list;
}

/** The end user signs in to the app (what the hosted sign-in page does). */
export function completeConnection(s: FakeState, user: string, app: string) {
  const list = platform(s).connections.get(user) ?? [];
  const conn = list.find((x) => x.app === app && x.status === "pending");
  if (conn) Object.assign(conn, { status: "active", name: "pat@example.com", connectedAt: new Date(s.now()).toISOString() });
}

function capabilityRoute(c: FakeCtx, id: string): Response | undefined {
  const p = platform(c.s);
  const b = (c.body ?? {}) as Record<string, unknown>;
  if (id.startsWith("apps.connection")) {
    const user = b.endUserRef;
    if (typeof user !== "string" || !/^[A-Za-z0-9_.-]{1,128}$/.test(user))
      return c.fail(400, "invalid_request", "endUserRef is required: your own reference for the end user, 1 to 128 letters, digits, '_', '.' or '-'.");
    const list = userConns(c, user);
    const app = typeof b.app === "string" ? b.app : undefined;
    if (id === "apps.connections.list") {
      return c.json(200, { results: list.filter((x) => !app || x.app === app).map((x) => ({ app: x.app, status: x.status, connectedAt: x.connectedAt, access: x.access })) });
    }
    if (id === "apps.connections.list-detailed") {
      return c.json(200, { results: list.filter((x) => (!app || x.app === app) && x.status !== "revoked" && x.status !== "pending").map(connView) });
    }
    if (id === "apps.connection.start") {
      if (typeof app !== "string" || !/^[a-z0-9_-]{1,64}$/.test(app)) return c.fail(400, "invalid_request", "app is required: the app id, lowercase, like \"gmail\".");
      const existing = list.find((x) => x.app === app);
      if (existing) existing.status = "pending";
      else list.push({ connectionId: `apn_${app}${++p.seq}`, app, status: "pending", connectedAt: new Date(c.now).toISOString(), access: "read-write" });
      const redirect = typeof b.redirectUrl === "string" ? b.redirectUrl : "http://localhost:3100/";
      const connect = new URL("/api/demo/connect", redirect);
      connect.search = new URLSearchParams({ user, app, redirect }).toString();
      return c.json(200, { connectUrl: connect.toString(), expiresAt: new Date(c.now + 600_000).toISOString() });
    }
    if (id === "apps.connection.get") {
      const conn = list.find((x) => x.connectionId === b.connectionId);
      if (!conn) return c.fail(404, "not_found", "No such connection. List them with apps.connections.list-detailed.");
      return c.json(200, { ...connView(conn), updatedAt: conn.connectedAt });
    }
    if (id === "apps.connection.revoke") {
      const live = list.filter((x) => x.app === app && x.status !== "revoked");
      live.forEach((x) => (x.status = "revoked"));
      return c.json(200, { revoked: live.length });
    }
    if (id === "apps.connection.delete") {
      const conn = list.find((x) => x.connectionId === b.connectionId);
      if (!conn) return c.fail(404, "not_found", "No such connection. List them with apps.connections.list-detailed.");
      if (b.confirm !== true) return c.fail(400, "invalid_request", "Send confirm: true to delete this connection for good.");
      conn.deleteApproval ??= c.addApproval({ capability: id, priceMicro: 0, input: b, requestedBy: { kind: "key" }, createdAt: c.now });
      return c.json(202, { job_id: conn.deleteApproval, status: "running", held_micro: 0 });
    }
  }
  if (id === "billing.credits.balance") {
    if (b.customerId !== "cus_example") return c.fail(404, "not_found", "No customer with that id. List them with billing.customers.list.");
    return c.json(200, { balances: [{ kind: "money", available: { amount: 1999, currency: "USD" }, reserved: { amount: 0, currency: "USD" } }] });
  }
  return undefined;
}

/** The platform routes of this fake. Returns undefined for a route it doesn't serve. */
export function platformRoutes(c: FakeCtx): Response | undefined {
  const { method, path } = c;
  const p = platform(c.s);

  if (method === "GET" && path === "/v1/balance") {
    const h = held(c.s);
    const today = p.usage.filter((r) => r.day === dayOf(c.now)).reduce((n, r) => n + r.spend_micro, 0);
    return c.json(200, { balance_micro: p.balanceMicro - h, today_spend_micro: today, daily_cap_micro: null, daily_cap_message: "no daily cap", held_micro: h });
  }
  if (method === "GET" && path === "/v1/usage") {
    const to = c.url.searchParams.get("to") ?? dayOf(c.now);
    const from = c.url.searchParams.get("from") ?? dayOf(Date.parse(to) - 29 * DAY);
    const results = p.usage.filter((r) => r.day >= from && r.day <= to).sort((a, b) => (a.day === b.day ? a.capability.localeCompare(b.capability) : a.day.localeCompare(b.day)));
    return c.json(200, { from, to, results });
  }
  if (method === "GET" && path === "/v1/accounts") {
    const at = new Date(c.now - 40 * DAY).toISOString();
    return c.json(200, {
      results: [
        { id: "acc_mail1", label: "Support inbox", family: "mail", origin: "own", status: "connected", created_at: at },
        { id: "acc_sms1", label: "Sender line", family: "messaging", origin: "platform", status: "connected", created_at: at },
        { id: "acc_cal1", label: "Team calendar", family: "calendar", origin: "own", status: "disconnected", created_at: at },
      ],
    });
  }

  if (method === "GET" && path === "/v1/outcomes") return c.json(200, { results: MISSIONS.map(info) });
  let m = path.match(/^\/v1\/outcomes\/([^/]+?)(\/estimate)?$/);
  if (m) {
    const mission = MISSIONS.find((x) => x.id === decodeURIComponent(m![1]));
    if (!mission) return c.fail(404, "not_found", "No outcome with that id. List them with GET /v1/outcomes.");
    if (method === "GET" && !m[2])
      return c.json(200, { ...info(mission), input_schema: mission.input_schema, options_schema: { type: "object", properties: {} }, result_schema: { type: "object" }, steps: mission.steps });
    const input = ((c.body as { input?: Record<string, unknown> } | undefined)?.input ?? {}) as Record<string, unknown>;
    if (method === "POST" && m[2]) {
      const problem = mission.check(input);
      const price = priceOf(mission);
      const available = p.balanceMicro - held(c.s);
      return c.json(200, {
        outcome: mission.id,
        version: 1,
        plan: planOf(mission, input),
        ready: !problem,
        can_run: !problem && available >= price,
        price_max_micro: price,
        steps: mission.steps.map((x) => ({ id: x.id, label: x.label, capability: x.capability, requires_approval: x.requires_approval, price_max_micro: x.price_max_micro })),
        ...(problem ? { message: problem } : {}),
        ...(available < price ? { top_up: topUp(c, price) } : {}),
      });
    }
    if (method === "POST" && !m[2]) {
      const problem = mission.check(input);
      if (problem) return c.json(400, { error: { code: "invalid_request", message: problem, effect: "none" } });
      const plan = planOf(mission, input);
      if (requiresApproval(mission) && c.headers["pramaan-plan"] !== plan)
        return c.json(403, { error: { code: "forbidden", reason: "approval_required", message: "This outcome needs approval. Estimate it, show a person the plan, then send its plan in Pramaan-Plan.", effect: "none" } });
      const key = c.headers["idempotency-key"];
      const prior = key ? p.idem.get(`${mission.id}:${key}`) : undefined;
      if (prior) return c.json(202, { job_id: prior, status: "running", held_micro: p.jobs.get(prior)?.holdMicro ?? 0 });
      const price = priceOf(mission);
      if (p.balanceMicro - held(c.s) < price)
        return c.json(402, { error: { code: "spend_cap_reached", reason: "balance", message: "Your balance is too low for this run. Add credit, then try again.", effect: "none", required_micro: price, top_up: topUp(c, price) } });
      const id = `job_fake${String(++p.seq).padStart(4, "0")}`;
      p.jobs.set(id, { id, mission, input, plan, holdMicro: price, createdAt: c.now, updatedAt: c.now, status: "running", idx: 0, cursorAt: c.now, done: [], charged: 0, approvals: {}, settled: false });
      c.s.holds.set(`job:${id}`, price);
      if (key) p.idem.set(`${mission.id}:${key}`, id);
      return c.json(202, { job_id: id, status: "running", held_micro: price });
    }
  }

  m = path.match(/^\/v1\/jobs\/([^/]+?)(\/cancel)?$/);
  if (m) {
    const j = p.jobs.get(decodeURIComponent(m[1]));
    if (!j) return undefined; // another block's job (approvals answer under their own routes)
    if (method === "GET" && !m[2]) return c.json(200, jobView(c, j));
    if (method === "POST" && m[2]) {
      advance(c, j);
      if (j.status !== "running") return c.fail(409, "conflict", "This job already finished, so there is nothing to cancel.");
      j.status = "cancelled";
      j.updatedAt = c.now;
      settle(c, j);
      return c.json(200, jobView(c, j));
    }
  }

  m = path.match(/^\/v1\/capabilities\/([^/]+)$/);
  if (method === "POST" && m) return capabilityRoute(c, decodeURIComponent(m[1]));
  return undefined;
}

export const fakeMissionIds = MISSIONS.map((x) => x.id);
