import type { FakeCtx, FakeState } from "./fake";
import { platform } from "./fake-platform";

// Fake provider-screen capabilities for the wave 3 blocks (checkout, payouts, identity, voice,
// booking, e-sign, upload, chat, account, subscriptions), with the documented shapes and the API's
// own style of message. Extends the core fake. Where a provider's own screen would load, the blocks
// show a marked stand-in; the demo's /api/demo route finishes things the outside world would.

export interface Wave3State {
  seq: number;
  idem: Map<string, string>;
  checkouts: Map<string, { ref: string; status: string; amount: number; currency: string; successUrl: string }>;
  /** The seller's payment account. `hosted` is an older account that onboards on a hosted page. */
  verifications: Map<string, { ref: string; status: string; checks: { check: string; status?: string; warnings: string[] }[] }>;
  account: { status: "ready" | "pending" | "restricted"; due: string[]; hosted: boolean; connected: boolean };
  voice?: VoiceState;
  calendar?: CalendarState;
}

export const wave3 = (s: FakeState): Wave3State =>
  (s.wave3 ??= { seq: 0, idem: new Map(), checkouts: new Map(), verifications: new Map(), account: { status: "pending", due: ["external_account", "business_profile.url"], hosted: false, connected: false } });
export const nextId = (s: FakeState, prefix: string) => `${prefix}_FAKE${String(++wave3(s).seq).padStart(6, "0")}`;

type Body = Record<string, unknown>;
type Handler = (c: FakeCtx, b: Body) => Response;

const handlers: Record<string, Handler> = {};

// ---- checkout (payments.checkout.*) ----

const CURRENCY = /^[a-z]{3}$/;

handlers["payments.checkout.create"] = (c, b) => {
  const items = b.lineItems;
  if (!Array.isArray(items) || items.length < 1 || items.length > 100) return c.fail(400, "invalid_request", "lineItems must hold 1 to 100 items.");
  let total = 0;
  for (const it of items as Body[]) {
    if (typeof it.name !== "string" || it.name.trim() === "") return c.fail(400, "invalid_request", "Every item needs a name.");
    if (!Number.isInteger(it.amount) || (it.amount as number) < 1) return c.fail(400, "invalid_request", "Every amount must be a whole number of cents, at least 1.");
    if (typeof it.currency !== "string" || !CURRENCY.test(it.currency) || it.currency !== (items[0] as Body).currency) return c.fail(400, "invalid_request", "Every item must use the same three-letter lowercase currency.");
    total += (it.amount as number) * ((it.quantity as number) || 1);
  }
  if (typeof b.successUrl !== "string" || typeof b.cancelUrl !== "string") return c.fail(400, "invalid_request", "successUrl and cancelUrl are required.");
  const ref = nextId(c.s, "ref");
  wave3(c.s).checkouts.set(ref, { ref, status: "unpaid", amount: total, currency: (items[0] as Body).currency as string, successUrl: b.successUrl });
  // The stand-in page lives in the app that asked, as the hosted page lives at the provider.
  return c.json(200, { ref, checkoutUrl: `${new URL(b.successUrl).origin}/checkout/stand-in?ref=${ref}`, expiresAt: new Date(c.now + 24 * 3_600_000).toISOString() });
};

handlers["payments.checkout.get"] = (c, b) => {
  const k = wave3(c.s).checkouts.get(String(b.ref));
  if (!k) return c.fail(404, "not_found", "Checkout not found. Check the ref.");
  return c.json(200, { status: k.status, payments: k.status === "paid" ? [{ ref: nextId(c.s, "ref"), status: "captured", amount: { amount: k.amount, currency: k.currency } }] : [] });
};

// ---- payouts (payments.account.*) ----

const REQUIRED = ["account_onboarding", "account_management", "notification_banner"];
const COMPONENTS = [...REQUIRED, "payouts", "payments", "balances", "documents"];

handlers["payments.account.connect"] = (c, b) => {
  if (typeof b.returnUrl !== "string" || typeof b.refreshUrl !== "string") return c.fail(400, "invalid_request", "returnUrl and refreshUrl are required.");
  const a = wave3(c.s).account;
  a.connected = true;
  return c.json(200, a.hosted ? { onboardingUrl: "https://onboarding.fake/setup#abc" } : { onboardingMode: "embedded", nextCapability: "payments.account.session.create" });
};

handlers["payments.account.session.create"] = (c, b) => {
  const asked = b.components === undefined ? [] : b.components;
  if (!Array.isArray(asked) || asked.some((x) => !COMPONENTS.includes(String(x)))) return c.fail(400, "invalid_request", `components must be among ${COMPONENTS.join(", ")}.`);
  if (!wave3(c.s).account.connected) return c.fail(409, "conflict", "No payment account yet. Call payments.account.connect first.");
  return c.json(200, {
    clientSecret: `fake_secret_${nextId(c.s, "s")}`,
    publishableKey: "pk_test_FAKE1",
    expiresAt: new Date(c.now + 3_600_000).toISOString(),
    components: [...new Set([...REQUIRED, ...(asked as string[])])],
  });
};

handlers["payments.account.status"] = (c) => {
  const { status, due } = wave3(c.s).account;
  return c.json(200, { status, chargesEnabled: status === "ready", payoutsEnabled: status === "ready", detailsSubmitted: due.length === 0, requirementsDue: due });
};

/** The seller finishes (or is blocked in) the provider's setup screen. */
export function setFakeAccount(s: FakeState, a: Partial<Wave3State["account"]>): void {
  const acc = wave3(s).account;
  Object.assign(acc, a, a.status === "ready" ? { due: [] } : {});
}

// ---- identity check (identity.verification.*) ----

handlers["identity.verification.create"] = (c, b) => {
  if (b.endUserId !== undefined && (typeof b.endUserId !== "string" || b.endUserId.length > 256)) return c.fail(400, "invalid_request", "endUserId must be text of up to 256 characters.");
  if (b.language !== undefined && !/^[a-z]{2}(-[A-Z]{2})?$/.test(String(b.language))) return c.fail(400, "invalid_request", "language must be one of the supported ISO 639-1 codes.");
  const ref = nextId(c.s, "ref");
  wave3(c.s).verifications.set(ref, { ref, status: "not_started", checks: [] });
  // The hosted screen lives with the provider; the demo app stands in for it.
  return c.json(200, { verificationUrl: `/identity/stand-in?ref=${ref}`, sessionNumber: wave3(c.s).verifications.size, status: "not_started", ref });
};

handlers["identity.verification.get"] = (c, b) => {
  const v = wave3(c.s).verifications.get(String(b.ref));
  if (!v) return c.fail(404, "not_found", "Verification not found. Check the ref.");
  // Like the real answer, it carries personal facts; the block must not pass them on.
  return c.json(200, { status: v.status, name: "Ada Lovelace", dateOfBirth: "1990-12-10", documentNumber: "X1234567", checks: v.checks });
};

/** The person finishes (or abandons) the provider's screen. */
export function finishFakeVerification(s: FakeState, ref: string, status: "approved" | "declined" | "in_review" | "in_progress"): void {
  const v = wave3(s).verifications.get(ref);
  if (!v) return;
  v.status = status;
  const row = (check: string, ok: boolean) => ({ check, status: ok ? "passed" : "failed", warnings: ok ? [] : ["MULTIPLE_FACES_DETECTED"] });
  v.checks = status === "in_progress" ? [] : [row("document", true), row("liveness", status !== "declined"), row("face_match", status === "approved")];
  if (status === "in_review") v.checks[2] = { check: "face_match", status: "review", warnings: [] };
}

/** The customer pays (or backs out) on the provider's page: what the stand-in's buttons do. */
export function finishFakeCheckout(s: FakeState, ref: string, status: "paid" | "cancelled"): string | undefined {
  const k = wave3(s).checkouts.get(ref);
  if (!k) return undefined;
  k.status = status;
  return k.successUrl;
}

// ---- chat, account and subscriptions: llm.chat, approval jobs, members/me, organization, billing.* ----

export interface FakeSub {
  subscriptionId: string;
  customerId: string;
  status: string;
  recurringAmount: { amount: number; currency: string };
  interval: string;
  intervalCount: number;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd?: string;
  nextBillingAt?: string;
  createdAt: string;
}

interface LaneC {
  orgName: string | null;
  subs: Map<string, FakeSub>;
  usage: Map<string, { customerId: string; event: string }>;
}

// Kept beside the shared state (not in it), so this block's state needs no change to Wave3State.
const laneC = new WeakMap<FakeState, LaneC>();

/** Billing and organisation state of the fake. `cus_FAKE0001` is the demo customer. */
export function laneCState(s: FakeState): LaneC {
  let x = laneC.get(s);
  if (!x) {
    const day = 86_400_000;
    const sub = (n: number, customerId: string, status: string, amount: number, cancelAtPeriodEnd = false): FakeSub => ({
      subscriptionId: `sub_FAKE${String(n).padStart(4, "0")}`,
      customerId,
      status,
      recurringAmount: { amount, currency: "usd" },
      interval: "month",
      intervalCount: 1,
      cancelAtPeriodEnd,
      currentPeriodEnd: new Date(Date.now() + 12 * day).toISOString(),
      nextBillingAt: status === "active" ? new Date(Date.now() + 12 * day).toISOString() : undefined,
      createdAt: new Date(Date.now() - 80 * day).toISOString(),
    });
    x = { orgName: null, subs: new Map(), usage: new Map() };
    for (const v of [sub(1, "cus_FAKE0001", "active", 29), sub(2, "cus_FAKE0002", "active", 99)]) x.subs.set(v.subscriptionId, v);
    laneC.set(s, x);
  }
  return x;
}

/** The customer cancels on the billing portal: the plan ends when the paid period does. */
export function cancelFakeSubscription(s: FakeState, customerId: string): boolean {
  const sub = [...laneCState(s).subs.values()].find((v) => v.customerId === customerId && v.status === "active");
  if (sub) sub.cancelAtPeriodEnd = true;
  return !!sub;
}

const frame = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;

/** A scripted model: a plain echo, or a send_email call when asked to email, then a closing line once the tool answers. */
function scripted(messages: Body[], tools: Body[]): { text: string; toolCalls: { id: string; name: string; arguments: Body }[] } {
  const last = messages[messages.length - 1];
  const content = String(last.content ?? "");
  if (last.role === "tool") {
    let out: Body = {};
    try {
      out = JSON.parse(content) as Body;
    } catch {}
    if (out.error) return { text: `That didn't go through: ${String((out.error as Body).message ?? "it was refused")}`, toolCalls: [] };
    return { text: out.status === "sent" ? "Done. The email is on its way." : "Done.", toolCalls: [] };
  }
  if (/\bemail\b/i.test(content) && tools.some((t) => t.name === "send_email")) {
    const to = content.match(/[^\s@]+@[^\s@]+\.[^\s@.,]+/)?.[0] ?? "sam@example.com";
    return { text: "Sure, I'll prepare that email. ", toolCalls: [{ id: `tc_FAKE${String(content.length).padStart(4, "0")}`, name: "send_email", arguments: { to, subject: "Hello", text: "Hi, just checking in." } }] };
  }
  return { text: `You said: ${content}`, toolCalls: [] };
}

handlers["llm.chat"] = (c, b) => {
  const messages = Array.isArray(b.messages) ? (b.messages as Body[]) : [];
  if (messages.length < 1) return c.fail(400, "invalid_request", "messages must hold at least one message.");
  const ids = new Set<string>();
  for (const m of messages) {
    if (m.role === "tool") {
      if (typeof m.toolCallId !== "string" || !ids.has(m.toolCallId)) return c.fail(400, "invalid_request", "A tool message must answer a tool call from the assistant message before it.");
    } else if (m.role === "assistant") for (const t of (m.toolCalls as Body[]) ?? []) ids.add(String(t.id));
    else if (m.role !== "user" && m.role !== "system") return c.fail(400, "invalid_request", "Every message needs a role of system, user, assistant or tool.");
  }
  const { text, toolCalls } = scripted(messages, Array.isArray(b.tools) ? (b.tools as Body[]) : []);
  const usage = { inputTokens: 7 * messages.length, outputTokens: Math.ceil(text.length / 4) };
  const result = { text, toolCalls, finishReason: toolCalls.length ? "tool_calls" : "stop", usage };
  if (!(c.headers.accept ?? "").includes("text/event-stream")) return c.json(200, result);
  const frames = [
    ...(text.match(/\S+\s*/g) ?? []).map((w) => frame("text_delta", { text: w })),
    ...toolCalls.flatMap((t, index) => [frame("tool_call_start", { index, id: t.id, name: t.name }), frame("tool_call_delta", { index, arguments: JSON.stringify(t.arguments) }), frame("tool_call_end", { index })]),
    frame("usage", usage),
    frame("done", { finishReason: result.finishReason, result, price_micro: 2_600 }),
  ];
  const enc = new TextEncoder();
  return new Response(new ReadableStream({ start: (ctl) => (frames.forEach((f) => ctl.enqueue(enc.encode(f))), ctl.close()) }), { status: 200, headers: { "content-type": "text/event-stream" } });
};

const PORTAL_MS = 15 * 60_000;
const sub = (s: FakeSub) => ({ ...s });

handlers["billing.subscriptions.list"] = (c, b) => {
  const rows = [...laneCState(c.s).subs.values()].filter((x) => (!b.customerId || x.customerId === b.customerId) && (!b.status || x.status === b.status));
  return c.json(200, { results: rows.map(sub) });
};

handlers["billing.portal.create"] = (c, b) => {
  if (typeof b.customerId !== "string" || ![...laneCState(c.s).subs.values()].some((x) => x.customerId === b.customerId)) return c.fail(404, "not_found", "Customer not found in your billing account.");
  const back = typeof b.returnUrl === "string" ? b.returnUrl : "http://localhost/";
  return c.json(200, { portalUrl: `${new URL(back).origin}/subscriptions/stand-in?customer=${encodeURIComponent(b.customerId)}&return=${encodeURIComponent(back)}`, expiresAt: new Date(c.now + PORTAL_MS).toISOString() });
};

handlers["billing.usage.record"] = (c, b) => {
  if (typeof b.customerId !== "string" || typeof b.event !== "string" || b.event === "") return c.fail(400, "invalid_request", "Send customerId and event.");
  const key = c.headers["idempotency-key"] ?? `${b.customerId}:${b.event}:${b.timestamp ?? c.now}`;
  const usage = laneCState(c.s).usage;
  const duplicate = usage.has(key);
  usage.set(key, { customerId: b.customerId, event: b.event });
  return c.json(200, { recorded: true, duplicate });
};

/** The approval a held call waits on, as GET /v1/jobs/{id} answers for it. */
function approvalJob(c: FakeCtx, id: string): Response {
  const a = c.s.approvals.get(id);
  if (!a) return c.fail(404, "not_found", "Job not found. Check the job_id.");
  const expired = a.status === "pending" && a.expiresAt <= c.now;
  const base = { job_id: a.id, approval_id: a.id, capability: a.capability, approval: { status: expired ? "expired" : a.status }, created_at: new Date(a.createdAt).toISOString(), updated_at: new Date(a.decidedAt ?? a.createdAt).toISOString() };
  const failed = (message: string) => c.json(200, { ...base, status: "failed", error: { code: "forbidden", message, effect: "none" } });
  if (expired) return failed("No member approved this call in time, so nothing ran.");
  if (a.status === "denied") return failed("A member declined this call, so nothing ran and nothing was charged.");
  if (a.status === "approved") return c.json(200, { ...base, status: "done", result: { status: "sent" } });
  return c.json(200, { ...base, status: a.status === "cancelled" ? "cancelled" : "running" });
}

const ORG = "org_FAKE0001";

/** The non-capability routes of the chat, account and subscriptions blocks. */
function laneCRoutes(c: FakeCtx): Response | undefined {
  const job = c.method === "GET" ? c.path.match(/^\/v1\/jobs\/(apr_[^/]+)$/) : null;
  if (job) return approvalJob(c, decodeURIComponent(job[1]));
  if (c.method === "GET" && c.path === "/v1/members/me") {
    const me = c.s.members.find((x) => x.member_id === c.headers["pramaan-member"]);
    if (!me) return c.fail(403, "forbidden", "This call acts for the workspace, not a member. Use a member's session or member token, or a key made for one member.");
    return c.json(200, { ...me, can_decide: me.may_approve, via: "key" });
  }
  if (c.path === "/v1/organization") {
    const st = laneCState(c.s);
    if (c.method === "GET") return c.json(200, { organization_id: ORG, name: st.orgName, name_set: st.orgName !== null });
    if (c.method === "PUT") {
      const me = c.s.members.find((x) => x.member_id === c.headers["pramaan-member"]);
      if (me && me.role !== "owner" && me.role !== "admin") return c.fail(403, "forbidden", "Only an owner or an admin can set the organisation's name.");
      const name = typeof (c.body as Body | undefined)?.name === "string" ? ((c.body as Body).name as string).trim().replace(/\s+/g, " ") : "";
      if (name.length < 2 || name.length > 200) return c.fail(400, "invalid_request", "The name must be 2 to 200 characters.");
      if (name.includes("@")) return c.fail(400, "invalid_request", "The name can't contain an email address.");
      st.orgName = name;
      return c.json(200, { organization_id: ORG, name, name_set: true });
    }
  }
  return undefined;
}

// ---- voice call (voice.browser-session.*, voice.browser-call.start, voice.call.end) ----
// A browser phone session, its events, and outbound calls. A call waits for a member's yes (the
// API asks for one on an irreversible call made with a key), then dials, then connects one fake
// step later. Events are worked out when they are read, from the fake clock.

const E164 = /^\+[1-9]\d{6,14}$/;
/** Dialling this number ends busy instead of connecting. */
export const FAKE_BUSY_NUMBER = "+15555550199";

interface VoiceEvent {
  id: string;
  type: string;
  at: string;
  callRef?: string;
  direction?: "outbound";
  from?: string;
  to?: string;
  reason?: string;
}
interface VoiceSession {
  ref: string;
  from: string;
  expiresAt: number;
  status: "open" | "closed" | "expired";
  events: VoiceEvent[];
}
interface VoiceCall {
  ref: string;
  session: string;
  to: string;
  approval: string;
  state: "pending" | "dialing" | "connected" | "ended" | "failed";
  placedAt?: number;
}
export interface VoiceState {
  sessions: Map<string, VoiceSession>;
  calls: Map<string, VoiceCall>;
  byKey: Map<string, string>;
}
const voice = (s: FakeState): VoiceState => (wave3(s).voice ??= { sessions: new Map(), calls: new Map(), byKey: new Map() });

function voiceTick(c: FakeCtx, sess: VoiceSession) {
  const v = voice(c.s);
  const emit = (type: string, at: number, call?: VoiceCall, reason?: string) =>
    sess.events.push({
      id: `ve_${sess.events.length + 1}`,
      type,
      at: new Date(at).toISOString(),
      ...(call ? { callRef: call.ref, direction: "outbound" as const, from: sess.from, to: call.to } : {}),
      ...(reason ? { reason } : {}),
    });
  const finish = (call: VoiceCall, at: number, type: "call.ended" | "call.failed", reason: string) => {
    call.state = type === "call.failed" ? "failed" : "ended";
    emit(type, at, call, reason);
  };
  for (const call of [...v.calls.values()].filter((x) => x.session === sess.ref)) {
    if (call.state === "pending") {
      const a = c.s.approvals.get(call.approval);
      if (a?.status === "approved") {
        call.state = "dialing";
        call.placedAt = a.decidedAt ?? c.now;
        emit("call.dialing", call.placedAt, call);
      } else if (a && a.status !== "pending") v.calls.delete(call.ref);
    }
    if (call.state === "dialing" && c.now >= call.placedAt! + c.s.stepMs) {
      const at = call.placedAt! + c.s.stepMs;
      if (call.to === FAKE_BUSY_NUMBER) finish(call, at, "call.failed", "busy");
      else {
        call.state = "connected";
        emit("call.connected", at, call);
      }
    }
  }
  if (sess.status === "open" && sess.expiresAt <= c.now) voiceClose(c, sess, "expired");
}

function voiceClose(c: FakeCtx, sess: VoiceSession, status: "closed" | "expired") {
  const emitEnd = (call: VoiceCall) => {
    call.state = "ended";
    sess.events.push({ id: `ve_${sess.events.length + 1}`, type: "call.ended", at: new Date(c.now).toISOString(), callRef: call.ref, direction: "outbound", from: sess.from, to: call.to, reason: "session_closed" });
  };
  for (const call of voice(c.s).calls.values()) if (call.session === sess.ref && (call.state === "dialing" || call.state === "connected")) emitEnd(call);
  sess.status = status;
  sess.events.push({ id: `ve_${sess.events.length + 1}`, type: status === "closed" ? "session.closed" : "session.expired", at: new Date(c.now).toISOString() });
}

function openSession(c: FakeCtx, ref: unknown): VoiceSession | Response {
  const sess = voice(c.s).sessions.get(String(ref));
  if (!sess) return c.fail(404, "not_found", "Phone session not found. Check the ref.");
  voiceTick(c, sess);
  return sess;
}

handlers["voice.browser-session.create"] = (c, b) => {
  if (typeof b.agent !== "string" || b.agent.trim() === "" || b.agent.length > 128) return c.fail(400, "invalid_request", "agent is required: your own id for the person using the phone.");
  if (typeof b.from !== "string" || !E164.test(b.from)) return c.fail(400, "invalid_request", "from must be one of your numbers in E.164 form, like +14155550100.");
  if (typeof b.origin !== "string" || !/^(https:\/\/[^/]+|http:\/\/localhost(:\d+)?)$/.test(b.origin)) return c.fail(400, "invalid_request", "origin must be the exact origin of your page, like https://desk.example.com.");
  const life = b.lifetimeSeconds === undefined ? 900 : Number(b.lifetimeSeconds);
  if (!Number.isInteger(life) || life < 60 || life > 3600) return c.fail(400, "invalid_request", "lifetimeSeconds must be from 60 to 3600.");
  const v = voice(c.s);
  const key = c.headers["idempotency-key"];
  const seen = key ? v.byKey.get(`session:${key}`) : undefined;
  const ref = seen ?? nextId(c.s, "ref");
  if (!seen) {
    v.sessions.set(ref, { ref, from: b.from, expiresAt: c.now + life * 1000, status: "open", events: [] });
    if (key) v.byKey.set(`session:${key}`, ref);
  }
  const sess = v.sessions.get(ref)!;
  return c.json(200, { ref, connectUrl: `wss://voice.pramaan.fake/s/${ref}`, credential: `cred_${ref}`, expiresAt: new Date(sess.expiresAt).toISOString(), number: sess.from });
};

handlers["voice.browser-call.start"] = (c, b) => {
  const sess = openSession(c, b.ref);
  if (sess instanceof Response) return sess;
  if (sess.status !== "open") return c.fail(409, "conflict", "That phone session has ended. Open a new one.");
  if (typeof b.to !== "string" || !E164.test(b.to)) return c.fail(400, "invalid_request", "to must be a phone number in E.164 form, like +14155550100.");
  const v = voice(c.s);
  const key = c.headers["idempotency-key"];
  const seen = key ? v.byKey.get(`call:${sess.ref}:${key}`) : undefined;
  if (seen) return c.json(202, { job_id: v.calls.get(seen)?.approval, status: "running", held_micro: 0 });
  const callRef = nextId(c.s, "ref");
  const approval = c.addApproval({ capability: "voice.browser-call.start", priceMicro: 30_000, input: { to: b.to }, requestedBy: { kind: "key" }, createdAt: c.now });
  v.calls.set(callRef, { ref: callRef, session: sess.ref, to: b.to, approval, state: "pending" });
  if (key) v.byKey.set(`call:${sess.ref}:${key}`, callRef);
  return c.json(202, { job_id: approval, status: "running", held_micro: 0 });
};

handlers["voice.call.end"] = (c, b) => {
  const call = voice(c.s).calls.get(String(b.ref));
  if (!call || call.state === "pending") return c.fail(404, "not_found", "Call not found. Check the ref.");
  const sess = voice(c.s).sessions.get(call.session)!;
  voiceTick(c, sess);
  if (call.state === "dialing" || call.state === "connected") {
    call.state = "ended";
    sess.events.push({ id: `ve_${sess.events.length + 1}`, type: "call.ended", at: new Date(c.now).toISOString(), callRef: call.ref, direction: "outbound", from: sess.from, to: call.to, reason: "completed" });
  }
  return c.json(200, { callRef: call.ref, state: call.state === "failed" ? "failed" : "ended" });
};

handlers["voice.browser-session.events"] = (c, b) => {
  const sess = openSession(c, b.ref);
  if (sess instanceof Response) return sess;
  const after = typeof b.cursor === "string" ? sess.events.findIndex((e) => e.id === b.cursor) + 1 : 0;
  return c.json(200, { events: sess.events.slice(after, after + (Number(b.limit) || 100)) });
};

handlers["voice.browser-session.close"] = (c, b) => {
  const sess = openSession(c, b.ref);
  if (sess instanceof Response) return sess;
  if (sess.status === "open") voiceClose(c, sess, "closed");
  return c.json(200, { status: sess.status === "expired" ? "expired" : "closed" });
};

// Optional bot-check evidence, through the same fake capability transport as the calendar calls.
handlers["auth.bot-check.verify"] = (c, b) => {
  if (typeof b.token !== "string" || !b.token) return c.fail(400, "invalid_request", "Complete the security check.");
  return c.json(200, { passed: b.token === "test-token" });
};

// ---- booking (calendar.free-busy.get, calendar.event.create) ----
// The person's own calendar, once connected. Every weekday is busy 15:00 to 16:00 UTC. A new event
// is irreversible and sends an invitation, so with a key it waits for a member's yes; once approved
// it is on the calendar and shows as busy. Times are read as UTC.

export interface CalEvent {
  ref: string;
  user: string;
  createdAt?: string;
  allDay?: boolean;
  transparency?: "free" | "transparent" | "busy" | "opaque";
  responseStatus?: "needs_action" | "accepted" | "declined" | "tentative";
  status?: "confirmed" | "tentative" | "cancelled";
  title: string;
  start: number;
  end: number;
}
export interface CalendarState {
  immediate?: boolean;
  events: CalEvent[];
  pending: { approval: string; event: CalEvent }[];
  byKey: Map<string, string>;
}
export const calendar = (s: FakeState): CalendarState => (wave3(s).calendar ??= { events: [], pending: [], byKey: new Map() });

function calendarTick(c: FakeCtx) {
  const cal = calendar(c.s);
  for (const p of [...cal.pending]) {
    const a = c.s.approvals.get(p.approval);
    if (a && a.status === "pending" && a.expiresAt > c.now) continue;
    cal.pending.splice(cal.pending.indexOf(p), 1);
    if (a?.status === "approved") cal.events.push(p.event);
  }
}

const CALENDAR_APPS = ["googlecalendar", "outlook"];

/** The calendar's owner, if their calendar app is connected. */
function calendarOwner(c: FakeCtx, b: Body): { user: string } | Response {
  const user = b.endUserRef;
  if (typeof user !== "string" || !/^[A-Za-z0-9_.-]{1,128}$/.test(user)) return c.fail(400, "invalid_request", "endUserRef is required: your own reference for the end user.");
  if (typeof b.app !== "string" || !CALENDAR_APPS.includes(b.app)) return c.fail(400, "invalid_request", "app must be googlecalendar or outlook.");
  const live = platform(c.s).connections.get(user)?.some((x) => x.app === b.app && x.status === "active");
  return live ? { user } : c.fail(409, "connection_required", "This calendar isn't connected. Connect it, then try again.");
}

const DAY_MS = 86_400_000;

handlers["calendar.free-busy.get"] = (c, b) => {
  calendarTick(c);
  const first = Array.isArray(b.calendars) ? (b.calendars[0] as Body | undefined) : undefined;
  if (!first || (b.calendars as unknown[]).length > 20) return c.fail(400, "invalid_request", "calendars must hold 1 to 20 calendars.");
  const owner = calendarOwner(c, first);
  if (owner instanceof Response) return owner;
  const after = Date.parse(String(b.after));
  const before = Date.parse(String(b.before));
  if (Number.isNaN(after) || Number.isNaN(before) || before <= after) return c.fail(400, "invalid_request", "after and before must be UTC instants, with before later.");
  if (before - after > 62 * DAY_MS) return c.fail(400, "invalid_request", "The window can be at most 62 days.");
  const busy: [number, number][] = [];
  for (let day = Math.floor(after / DAY_MS) * DAY_MS; day < before; day += DAY_MS) {
    const weekday = new Date(day).getUTCDay();
    if (weekday >= 1 && weekday <= 5) busy.push([day + 15 * 3_600_000, day + 16 * 3_600_000]);
  }
  for (const e of calendar(c.s).events) if (e.user === owner.user && e.status !== "cancelled" && e.responseStatus !== "declined" && e.transparency !== "free" && e.transparency !== "transparent") busy.push([e.start, e.end]);
  const merged: [number, number][] = [];
  for (const [start, end] of busy.sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  const rows = merged
    .filter(([s, e]) => e > after && s < before)
    .sort((x, y) => x[0] - y[0])
    .map(([s, e]) => ({ start: new Date(Math.max(s, after)).toISOString(), end: new Date(Math.min(e, before)).toISOString() }));
  return c.json(200, { results: [{ calendar: 0, busy: rows }] });
};

handlers["calendar.event.create"] = (c, b) => {
  calendarTick(c);
  const owner = calendarOwner(c, b);
  if (owner instanceof Response) return owner;
  if (typeof b.title !== "string" || b.title.trim() === "" || b.title.length > 1000) return c.fail(400, "invalid_request", "title is required, up to 1,000 characters.");
  const start = Date.parse(`${b.start}Z`);
  const end = Date.parse(`${b.end}Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return c.fail(400, "invalid_request", "start and end are required wall-clock times, like 2026-10-15T14:00:00, with end later.");
  for (const a of (b.attendees as Body[] | undefined) ?? []) if (typeof a.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email)) return c.fail(400, "invalid_request", "Every attendee needs a valid email address.");
  const cal = calendar(c.s);
  const key = c.headers["idempotency-key"];
  const seen = key ? cal.byKey.get(key) : undefined;
  if (seen) return c.json(202, { job_id: seen, status: "running", held_micro: 0 });
  const event = { ref: nextId(c.s, "ref"), createdAt: new Date(c.now).toISOString(), user: owner.user, title: b.title, start, end };
  if (cal.immediate) {
    cal.events.push(event);
    return c.json(200, eventRow(event));
  }
  const approval = c.addApproval({ capability: "calendar.event.create", priceMicro: 3_000, input: b, requestedBy: { kind: "key" }, createdAt: c.now });
  cal.pending.push({ approval, event });
  if (key) cal.byKey.set(key, approval);
  return c.json(202, { job_id: approval, status: "running", held_micro: 0 });
};

function eventRow(e: CalEvent) {
  return { ref: e.ref, createdAt: e.createdAt, title: e.title, kind: "single", allDay: e.allDay ?? false,
    ...(e.transparency ? { transparency: e.transparency } : {}), ...(e.responseStatus ? { responseStatus: e.responseStatus } : {}),
    startAt: new Date(e.start).toISOString(), endAt: new Date(e.end).toISOString(), timezone: "UTC", status: e.status ?? "confirmed" };
}
handlers["calendar.events.list"] = (c, b) => {
  calendarTick(c);
  const owner = calendarOwner(c, b);
  if (owner instanceof Response) return owner;
  const after = Date.parse(String(b.after));
  const before = Date.parse(String(b.before));
  if (!Number.isFinite(after) || !Number.isFinite(before) || after >= before) return c.fail(400, "invalid_request", "Choose a valid time range.");
  const events = calendar(c.s).events.filter((e) => e.user === owner.user && e.start < before && e.end > after).sort((a, b) => a.start - b.start);
  const offset = Number(b.cursor ?? 0);
  const limit = Number(b.limit ?? 10);
  return c.json(200, { results: events.slice(offset, offset + limit).map(eventRow), ...(offset + limit < events.length ? { nextCursor: String(offset + limit) } : {}) });
};
handlers["calendar.event.delete"] = (c, b) => {
  const owner = calendarOwner(c, b);
  if (owner instanceof Response) return owner;
  const cal = calendar(c.s);
  const index = cal.events.findIndex((e) => e.user === owner.user && e.ref === b.ref);
  if (index < 0) return c.fail(404, "not_found", "That booking couldn't be found.");
  cal.events.splice(index, 1);
  return c.json(200, { deleted: true });
};

// ---- e-sign (signature.request.* and signature.requests.list) ----

interface FakeSigner { name: string; email: string; status: "waiting" | "viewed" | "signed"; signedAt?: number }
interface FakeSignature { ref: string; title: string; createdAt: number; signers: FakeSigner[]; reminders: number }
const signatures = new WeakMap<FakeState, Map<string, FakeSignature>>();
const sigs = (s: FakeState) => signatures.get(s) ?? signatures.set(s, new Map()).get(s)!;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** A document id in the shape the API accepts, for the demo's sample agreement. */
export const DEMO_DOCUMENT_ID = "file_FAKE0000000000000000000001";
const FILE_ID = /^file_[0-9A-HJKMNP-TV-Z]{26}$/;

function sigStatus(r: FakeSignature) {
  if (r.signers.every((x) => x.status === "signed")) return "completed";
  if (r.signers.some((x) => x.status === "signed")) return "partially-signed";
  return r.signers.some((x) => x.status === "viewed") ? "viewed" : "sent";
}
const lastSigned = (r: FakeSignature) => Math.max(...r.signers.map((x) => x.signedAt ?? 0));

const held = new WeakSet<FakeState>();
/** The next send waits for a member's yes, as the API holds some calls (a 202 with an approval id). */
export const holdFakeSignatureSend = (s: FakeState) => void held.add(s);

handlers["signature.request.send"] = (c, b) => {
  const text = (v: unknown, max: number) => typeof v === "string" && v.trim() !== "" && v.length <= max;
  if (!text(b.title, 100)) return c.fail(400, "invalid_request", "title is required, up to 100 characters.");
  if (!text(b.subject, 100)) return c.fail(400, "invalid_request", "subject is required, up to 100 characters.");
  const docs = b.documents as Body[] | undefined;
  if (!Array.isArray(docs) || docs.length < 1 || docs.length > 10) return c.fail(400, "invalid_request", "documents must hold 1 to 10 files.");
  for (const d of docs) {
    if (typeof d.fileId !== "string" || !FILE_ID.test(d.fileId)) return c.fail(400, "invalid_request", "fileId must be the id of a file you uploaded.");
    if (typeof d.filename !== "string" || !/^[^/\\]+\.(pdf|png|jpe?g)$/i.test(d.filename)) return c.fail(400, "invalid_request", "filename must end in .pdf, .png or .jpg.");
  }
  const signers = b.signers as Body[] | undefined;
  if (!Array.isArray(signers) || signers.length < 1 || signers.length > 20) return c.fail(400, "invalid_request", "signers must hold 1 to 20 people.");
  for (const x of signers) if (!text(x.name, 100) || typeof x.email !== "string" || !EMAIL.test(x.email)) return c.fail(400, "invalid_request", "Every signer needs a name and an email address.");
  if (new Set(signers.map((x) => String(x.email).toLowerCase())).size !== signers.length) return c.fail(400, "invalid_request", "Each signer needs a different email address.");
  if (held.delete(c.s)) return c.json(202, { approval_id: nextId(c.s, "apr"), status: "pending" });
  const ref = nextId(c.s, "ref");
  sigs(c.s).set(ref, {
    ref, title: b.title as string, createdAt: c.now, reminders: 0,
    signers: signers.map((x) => ({ name: x.name as string, email: String(x.email).toLowerCase(), status: "waiting" as const })),
  });
  return c.json(200, { status: "sent", delivery: "email", ref });
};

handlers["signature.requests.list"] = (c) => {
  const rows = [...sigs(c.s).values()].sort((a, z) => z.createdAt - a.createdAt);
  return c.json(200, { results: rows.map((r) => ({ ref: r.ref, title: r.title, status: sigStatus(r), createdAt: new Date(r.createdAt).toISOString(), updatedAt: new Date(Math.max(r.createdAt, lastSigned(r))).toISOString() })) });
};

handlers["signature.request.get"] = (c, b) => {
  const r = sigs(c.s).get(String(b.ref));
  if (!r) return c.fail(404, "not_found", "Signing request not found. Check the ref.");
  const status = sigStatus(r);
  return c.json(200, {
    title: r.title, status, createdAt: new Date(r.createdAt).toISOString(),
    ...(status === "completed" ? { completedAt: new Date(lastSigned(r)).toISOString() } : {}),
    ...(b.includeSigners === false ? {} : { signers: r.signers.map((x) => ({ name: x.name, email: x.email, status: x.status, ...(x.signedAt ? { signedAt: new Date(x.signedAt).toISOString() } : {}) })) }),
    downloadable: status === "completed",
  });
};

handlers["signature.request.remind"] = (c, b) => {
  const r = sigs(c.s).get(String(b.ref));
  if (!r) return c.fail(404, "not_found", "Signing request not found. Check the ref.");
  if (b.confirm !== true) return c.fail(400, "invalid_request", "confirm must be true to email a reminder.");
  const who = r.signers.find((x) => x.email === String(b.signerEmail).toLowerCase());
  if (!who || who.status === "signed") return c.fail(400, "invalid_request", "That email isn't a current signer on this request.");
  r.reminders++;
  return c.json(200, { status: "requested" });
};

const PDF = "data:application/pdf;base64,JVBERi0xLjQKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+ZW5kb2JqCjIgMCBvYmo8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PmVuZG9iagozIDAgb2JqPDwvVHlwZS9QYWdlL1BhcmVudCAyIDAgUi9NZWRpYUJveFswIDAgMjAwIDIwMF0+PmVuZG9iagp0cmFpbGVyPDwvUm9vdCAxIDAgUj4+CiUlRU9G";
handlers["signature.request.download"] = (c, b) => {
  const r = sigs(c.s).get(String(b.ref));
  if (!r) return c.fail(404, "not_found", "Signing request not found. Check the ref.");
  if (sigStatus(r) !== "completed") return c.fail(409, "conflict", "The agreement isn't fully signed yet, so there is nothing to download.");
  return c.json(200, { state: "completed", file: { fileId: `file_FAKE${String(wave3(c.s).seq++).padStart(22, "0")}`, url: PDF, expiresAt: new Date(c.now + 7 * 24 * 3_600_000).toISOString(), contentType: "application/pdf", sizeBytes: 300 } });
};

/** A signer opens the emailed link (what the signing page does). */
export function viewFakeSignature(s: FakeState, ref: string, email: string): boolean {
  const x = sigs(s).get(ref)?.signers.find((y) => y.email === email.toLowerCase());
  if (!x) return false;
  if (x.status === "waiting") x.status = "viewed";
  return true;
}
/** A signer signs on the provider's signing page. */
export function signFakeSignature(s: FakeState, ref: string, email: string): boolean {
  const x = sigs(s).get(ref)?.signers.find((y) => y.email === email.toLowerCase());
  if (!x) return false;
  Object.assign(x, { status: "signed", signedAt: s.now() });
  return true;
}
/** How many reminders went out for a request (for tests). */
export const fakeReminders = (s: FakeState, ref: string) => sigs(s).get(ref)?.reminders ?? 0;

// ---- upload (POST /v1/files/uploads, /v1/files/{id}/finish, GET and DELETE /v1/files) ----

interface FakeFile { fileId: string; kind: string; contentType: string; sizeBytes: number; createdAt: number; bytes?: Uint8Array; ready: boolean }
const files = new WeakMap<FakeState, Map<string, FakeFile>>();
const fileMap = (s: FakeState) => files.get(s) ?? files.set(s, new Map()).get(s)!;
const KINDS = ["audio", "image", "video", "document", "data"];
/** The API's direct-upload limits: audio, document and data 100 MB, video 500 MB, image 20 MB. */
const LIMIT: Record<string, number> = { audio: 100e6, document: 100e6, data: 100e6, video: 500e6, image: 20e6 };
const FILE_DAYS = 7;
const fileFacts = (c: FakeCtx, f: FakeFile) => ({
  fileId: f.fileId, kind: f.kind, origin: "upload", contentType: f.contentType, sizeBytes: f.sizeBytes,
  createdAt: new Date(f.createdAt).toISOString(), expiresAt: new Date(f.createdAt + FILE_DAYS * 86_400_000).toISOString(),
  url: `/api/demo/storage/${f.fileId}`,
});

/** The bytes arrive at the storage link (what the browser's PUT does). */
export function storeFakeUpload(s: FakeState, fileId: string, bytes: Uint8Array): boolean {
  const f = fileMap(s).get(fileId);
  if (!f) return false;
  f.bytes = bytes;
  return true;
}
/** What the storage link serves for a ready file. */
export const fakeUploadBytes = (s: FakeState, fileId: string) => { const f = fileMap(s).get(fileId); return f?.ready && f.bytes ? { bytes: f.bytes, contentType: f.contentType } : undefined; };

function fileRoutes(c: FakeCtx): Response | undefined {
  const body = (c.body ?? {}) as Body;
  if (c.method === "POST" && c.path === "/v1/files/uploads") {
    const { kind, contentType, sizeBytes } = body;
    if (typeof kind !== "string" || !KINDS.includes(kind) || typeof contentType !== "string" || !contentType || !Number.isInteger(sizeBytes) || (sizeBytes as number) < 1)
      return c.fail(400, "invalid_request", "Send kind, contentType and a positive integer sizeBytes.");
    if ((sizeBytes as number) > LIMIT[kind]) return c.fail(400, "invalid_request", `A ${kind} file can be at most ${LIMIT[kind] / 1e6} MB.`);
    const fileId = `file_FAKE${String(1000 + ++wave3(c.s).seq).padStart(22, "0")}`;
    fileMap(c.s).set(fileId, { fileId, kind, contentType, sizeBytes: sizeBytes as number, createdAt: c.now, ready: false });
    return c.json(201, { fileId, uploadUrl: `/api/demo/storage/${fileId}`, headers: { "content-type": contentType }, expiresAt: new Date(c.now + 15 * 60_000).toISOString() });
  }
  let m = c.path.match(/^\/v1\/files\/([^/]+)\/finish$/);
  if (c.method === "POST" && m) {
    const f = fileMap(c.s).get(m[1]);
    if (!f) return c.fail(404, "not_found", "File not found.");
    if (f.bytes?.length !== f.sizeBytes) return c.fail(400, "invalid_request", "The file didn't arrive in full. Start a new upload.");
    f.ready = true;
    return c.json(200, fileFacts(c, f));
  }
  if (c.method === "GET" && c.path === "/v1/files") {
    const rows = [...fileMap(c.s).values()].filter((f) => f.ready).sort((a, z) => z.createdAt - a.createdAt);
    return c.json(200, { results: rows.map((f) => fileFacts(c, f)) });
  }
  m = c.path.match(/^\/v1\/files\/([^/]+)$/);
  if (m && (c.method === "GET" || c.method === "DELETE")) {
    const f = fileMap(c.s).get(m[1]);
    if (!f) return c.fail(404, "not_found", "File not found.");
    if (c.method === "GET") return c.json(200, fileFacts(c, f));
    fileMap(c.s).delete(m[1]);
    return c.json(200, { deleted: true });
  }
  return undefined;
}

/** The wave 3 routes of this fake. Returns undefined for a route it doesn't serve. */
export function wave3Routes(c: FakeCtx): Response | undefined {
  const file = fileRoutes(c);
  if (file) return file;
  const m = c.path.match(/^\/v1\/capabilities\/([^/]+)$/);
  const h = c.method === "POST" && m ? handlers[decodeURIComponent(m[1])] : undefined;
  return h ? h(c, (c.body ?? {}) as Body) : laneCRoutes(c);
}
