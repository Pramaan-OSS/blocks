import type { FakeApproval, FakeCtx, FakeState } from "./fake";

// Fake opt-out lists (messaging.opt-out* superpowers), with the documented shapes and the API's own
// messages. Extends the core fake. Addresses are stored whole but only a masked hint is ever
// returned, as the API does. An entry the person made themselves (a STOP reply or an unsubscribe
// link) can't be removed by the project.

const DAY = 86_400_000;
const CHANNELS = ["sms", "whatsapp", "voice", "email"];

interface Entry {
  id: string;
  address: string;
  channel: string;
  source: "builder_api" | "inbound_stop" | "unsubscribe_link";
  reason?: string;
  createdAt: number;
  createdBy?: string;
  removedAt?: number;
  removedBy?: string;
}

export interface ConsentState {
  entries: Entry[];
  stops: { stopId: string; addressHint: string; sendingNumberHint: string; channel: string; createdAt: number }[];
  seq: number;
  pending?: { approval: string; optOutId: string }[];
}

const hint = (a: string) => `${a.slice(0, 3)}…${a.slice(-2)}`;

function seedConsent(s: FakeState): ConsentState {
  const now = s.now();
  const st: ConsentState = { entries: [], stops: [], seq: 0 };
  const add = (address: string, channel: string, source: Entry["source"], ago: number, reason?: string) =>
    st.entries.push({ id: `opt_FAKE${String(++st.seq).padStart(22, "0")}`, address, channel, source, createdAt: now - ago * DAY, ...(reason ? { reason } : {}) });
  add("+14155550100", "sms", "builder_api", 30, "Asked by phone");
  add("pat@example.com", "email", "unsubscribe_link", 12);
  add("+442071838750", "all", "builder_api", 3, "Asked to stop all contact");
  st.stops.push({ stopId: "stop_FAKE0001", addressHint: "+44…77", sendingNumberHint: "+14…21", channel: "sms", createdAt: now - 6 * DAY });
  return st;
}

export const consent = (s: FakeState): ConsentState => (s.consent ??= seedConsent(s));

/** Applies an approved removal once; protected recipient choices remain active. */
export function applyConsentRemoval(s: FakeState, approval: FakeApproval) {
  if (approval.capability !== "messaging.opt-out.remove" || approval.status !== "approved" || approval.result !== undefined) return;
  const id = (approval.input as { optOutId?: string }).optOutId;
  const entry = consent(s).entries.find((e) => e.id === id && !e.removedAt && e.source === "builder_api");
  if (entry) { entry.removedAt = s.now(); entry.removedBy = approval.decidedBy; }
  approval.result = { removed: entry ? 1 : 0 };
}

/** The same normal form the API keeps: an email lower-cased, a phone number as +digits. */
function normalise(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const v = raw.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return v.toLowerCase();
  const phone = v.replace(/[\s().-]/g, "");
  return /^\+[1-9]\d{6,14}$/.test(phone) ? phone : undefined;
}

const iso = (ms: number) => new Date(ms).toISOString();
const view = (e: Entry) => ({ optOutId: e.id, addressHint: hint(e.address), channel: e.channel, source: e.source, ...(e.reason ? { reason: e.reason } : {}), createdAt: iso(e.createdAt), ...(e.createdBy ? { createdBy: e.createdBy } : {}), ...(e.removedAt ? { removedAt: iso(e.removedAt), removedBy: e.removedBy } : {}) });

const BAD_ADDRESS = "address must be a phone number with its country code (like +14155550100) or an email address.";

function capability(c: FakeCtx, id: string): Response | undefined {
  if (!id.startsWith("messaging.opt-out")) return undefined;
  const st = consent(c.s);
  for (const pending of st.pending ?? []) {
    const approval = c.s.approvals.get(pending.approval);
    if (approval) applyConsentRemoval(c.s, approval);
  }
  const b = (c.body ?? {}) as Record<string, unknown>;
  if (id === "messaging.opt-outs.list") {
    const limit = Math.min(100, Math.max(1, Number(b.limit) || 50));
    const start = typeof b.cursor === "string" ? Number(b.cursor) || 0 : 0;
    const rows = st.entries.filter((e) => Boolean(e.removedAt) === (b.removed === true) && (!b.channel || e.channel === b.channel) && (!b.source || e.source === b.source) && (!b.query || hint(e.address).toLowerCase().includes(String(b.query).toLowerCase()))).sort((x, y) => x.createdAt - y.createdAt);
    const next = start + limit;
    return c.json(200, {
      results: rows.slice(start, next).map(view),
      ...(next < rows.length ? { nextCursor: String(next) } : {}),
      ...(start === 0 ? { organisationStops: st.stops.map((x) => ({ ...x, source: "inbound_stop", createdAt: iso(x.createdAt) })) } : {}),
    });
  }
  if (id === "messaging.opt-out.remove") {
    if (b.confirm !== true || (typeof b.optOutId === "string") === (typeof b.address === "string")) return c.fail(400, "invalid_request", "Confirm and choose one entry.");
    const found = st.entries.find((e) => e.id === b.optOutId && !e.removedAt);
    if (!found) return c.fail(404, "not_found", "Opt-out not found.");
    const approval = c.addApproval({ capability: id, priceMicro: 0, input: { optOutId: found.id, confirm: true }, requestedBy: { kind: "key" }, createdAt: c.now });
    (st.pending ??= []).push({ approval, optOutId: found.id });
    return c.json(202, { job_id: approval, approval_id: approval, status: "running", held_micro: 0 });
  }
  const address = normalise(b.address);
  if (!address) return c.fail(400, "invalid_request", BAD_ADDRESS);
  const email = address.includes("@");
  if (id === "messaging.opt-out.check") {
    if (!CHANNELS.includes(String(b.channel))) return c.fail(400, "invalid_request", "channel must be sms, whatsapp, voice or email.");
    const blocked = st.entries.some((e) => !e.removedAt && e.address === address && (e.channel === "all" || e.channel === b.channel)) || st.stops.some((x) => hint(address) === x.addressHint && x.channel === b.channel);
    return c.json(200, { blocked });
  }
  if (id === "messaging.opt-out.add") {
    const channel = b.channel === undefined ? "all" : String(b.channel);
    if (![...CHANNELS, "all"].includes(channel)) return c.fail(400, "invalid_request", "channel must be sms, whatsapp, voice, email or all.");
    if (email && channel === "sms") return c.fail(400, "invalid_request", "An email address can only be blocked on email or all.");
    const existing = st.entries.find((e) => e.address === address && e.channel === channel);
    if (existing) return c.json(200, view(existing));
    const entry: Entry = { id: `opt_FAKE${String(++st.seq).padStart(22, "0")}`, address, channel, source: "builder_api", createdBy: c.headers["pramaan-member"], createdAt: c.now, ...(typeof b.reason === "string" && b.reason ? { reason: b.reason.slice(0, 200) } : {}) };
    st.entries.push(entry);
    return c.json(200, view(entry));
  }
  return c.fail(404, "not_found", "No capability with that id. List them with GET /v1/capabilities.");
}

/** The consent routes of this fake. Returns undefined for a route it doesn't serve. */
export function consentRoutes(c: FakeCtx): Response | undefined {
  if (c.method === "POST" && c.path.startsWith("/unsubscribe/")) {
    if (c.path !== "/unsubscribe/recipient_demo") return c.fail(404, "not_found", "This link does not work.");
    const st = consent(c.s);
    if (!st.entries.some((e) => e.address === "recipient@example.com")) st.entries.push({ id: `opt_FAKE${String(++st.seq).padStart(22, "0")}`, address: "recipient@example.com", channel: "email", source: "unsubscribe_link", createdAt: c.now });
    return c.json(200, { ok: true });
  }
  const m = c.path.match(/^\/v1\/capabilities\/([^/]+)$/);
  return c.method === "POST" && m ? capability(c, decodeURIComponent(m[1])) : undefined;
}
