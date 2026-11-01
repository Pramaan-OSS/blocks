// An in-memory Pramaan for demos and tests (PRAMAAN_FAKE=1). It answers the platform routes the
// blocks use with the documented shapes and the API's own messages. Nothing leaves the process.
//
// Routes beyond approvals live beside it: fake-platform.ts (missions, jobs, wallet, connections)
// and fake-assessment.ts (exams, invitations, email). They share this state.
//
// One deliberate difference: the real API lets only a member signed in to the dashboard list or
// decide approvals, so a server key gets 403 today. The fake accepts the key and
// treats `Pramaan-Member` as the person deciding, which is the access the real API does not give yet.

import { assessmentRoutes, type AssessmentState } from "./fake-assessment";
import { type ActivityState, activityRoutes } from "./fake-activity";
import { type ConsentState, consentRoutes } from "./fake-consent";
import { catalogueDescribe, catalogueRoutes } from "./fake-catalogue";
import { addFakeMemory as addMemoryTo, memoryRoutes, type MemoryState } from "./fake-memory";
import { completeConnection, platformRoutes, type PlatformState } from "./fake-platform";
import { type Wave3State, wave3Routes } from "./fake-wave3";

type ApprovalStatus = "pending" | "approved" | "denied" | "cancelled";

export interface FakeApproval {
  id: string;
  capability: string;
  priceMicro: number;
  input: unknown;
  requestedBy: { kind: string; act?: string; member_id?: string };
  createdAt: number;
  expiresAt: number;
  status: ApprovalStatus;
  decidedBy?: string;
  decidedAt?: number;
  /** How many times the approved call ran. Must never pass 1. */
  runs: number;
}

export interface FakeMember {
  member_id: string;
  email: string;
  role: "owner" | "admin" | "member" | "viewer";
  can_approve: boolean;
  may_approve: boolean;
}

export interface FakeRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: unknown;
}

export interface FakeState {
  approvals: Map<string, FakeApproval>;
  members: FakeMember[];
  capabilities: Record<string, { description: string; effect_class: string }>;
  failures: { method: string; path: string; status: number; error: Record<string, unknown> }[];
  requests: FakeRequest[];
  seq: number;
  now: () => number;
  /** How long a fake mission step takes, ms (PRAMAAN_FAKE_STEP_MS). */
  stepMs: number;
  /** Credit set aside, by what holds it: running missions, unused invitations. */
  holds: Map<string, number>;
  platform?: PlatformState;
  assessment?: AssessmentState;
  memory?: MemoryState;
  consent?: ConsentState;
  activity?: ActivityState;
  wave3?: Wave3State;
}

/** What a route handler in a fake-*.ts file gets to work with. */
export interface FakeCtx {
  s: FakeState;
  method: string;
  path: string;
  url: URL;
  headers: Record<string, string>;
  body: unknown;
  now: number;
  json: (status: number, body: unknown) => Response;
  fail: (status: number, code: string, message: string) => Response;
  addApproval: (a: Partial<FakeApproval> & Pick<FakeApproval, "capability" | "input">) => string;
}

const MINUTE = 60_000;
const TTL = 24 * 60 * MINUTE;

function seed(): FakeState {
  const now = Date.now();
  const s: FakeState = {
    approvals: new Map(),
    members: [
      { member_id: "mbr_owner", email: "owner@example.com", role: "owner", can_approve: true, may_approve: true },
      { member_id: "mbr_viewer", email: "viewer@example.com", role: "viewer", can_approve: false, may_approve: false },
    ],
    capabilities: {
      "email.send": { description: "Sends one email from your connected inbox.", effect_class: "external_irreversible" },
      "sms.send": { description: "Sends a text message to one phone number.", effect_class: "external_irreversible" },
      "social.post.publish": { description: "Publishes or schedules a post on your connected social accounts.", effect_class: "external_irreversible" },
    },
    failures: [],
    requests: [],
    seq: 0,
    now: () => Date.now(),
    stepMs: Number(process.env.PRAMAAN_FAKE_STEP_MS) || 2_000,
    holds: new Map(),
  };
  addTo(s, {
    capability: "email.send",
    priceMicro: 2_000,
    input: { to: "pat@example.com", subject: "Your invoice", text: "Hi Pat, your invoice is attached." },
    requestedBy: { kind: "key", member_id: "mbr_viewer" },
    createdAt: now - 5 * MINUTE,
  });
  addTo(s, {
    capability: "sms.send",
    priceMicro: 9_100,
    input: { to: "+15555550100", text: "Your table is ready." },
    requestedBy: { kind: "partner", act: "app" },
    createdAt: now - 30 * MINUTE,
  });
  return s;
}

function addTo(s: FakeState, a: Partial<FakeApproval> & Pick<FakeApproval, "capability" | "input">): string {
  const id = a.id ?? `apr_fake${String(++s.seq).padStart(4, "0")}`;
  const createdAt = a.createdAt ?? s.now();
  s.approvals.set(id, {
    priceMicro: 1_000,
    requestedBy: { kind: "key" },
    expiresAt: createdAt + TTL,
    status: "pending",
    runs: 0,
    ...a,
    id,
    createdAt,
  });
  return id;
}

const g = globalThis as { __pramaanFake?: FakeState };

/** The fake's state, shared across route modules in one process. */
export function fakeState(): FakeState {
  return (g.__pramaanFake ??= seed());
}

/** Back to the seed data. */
export function resetFake(): FakeState {
  g.__pramaanFake = seed();
  return g.__pramaanFake;
}

/** Adds a call waiting for approval (as a send held by the API would). Returns its id. */
export function addFakeApproval(a: Partial<FakeApproval> & Pick<FakeApproval, "capability" | "input">): string {
  return addTo(fakeState(), a);
}

/** The next matching request fails with this error body, as the API would send it. */
export function failNext(method: string, path: string, status: number, error: Record<string, unknown>): void {
  fakeState().failures.push({ method, path, status, error });
}

/** The end user finishes signing in to an app (what the hosted sign-in page does). */
export function completeFakeConnection(user: string, app: string): void {
  completeConnection(fakeState(), user, app);
}

/** Adds a private memory for a person, as a chat would over time. */
export function addFakeMemory(s: FakeState, user: string, text: string): string {
  return addMemoryTo(s, user, text);
}

/** Another member decides it first. */
export function decideElsewhere(id: string, status: "approved" | "denied", by = "mbr_other"): void {
  const a = fakeState().approvals.get(id);
  if (!a) return;
  Object.assign(a, { status, decidedBy: by, decidedAt: fakeState().now() });
  if (status === "approved") a.runs++;
}

const json = (status: number, body: unknown) => Response.json(body, { status });
const fail = (status: number, code: string, message: string) => json(status, { error: { code, message } });
const iso = (ms: number) => new Date(ms).toISOString();

function summary(a: FakeApproval) {
  return {
    approval_id: a.id,
    capability: a.capability,
    price_micro: a.priceMicro,
    input: a.input,
    requested_by: a.requestedBy,
    created_at: iso(a.createdAt),
    expires_at: iso(a.expiresAt),
  };
}

// Mirrors the API's approval job view (apps/api/src/approvals.ts approvalJob).
function job(a: FakeApproval, now: number) {
  const expired = a.status === "pending" && a.expiresAt <= now;
  const base = {
    job_id: a.id,
    approval_id: a.id,
    capability: a.capability,
    approval: { status: expired ? "expired" : a.status, ...(a.decidedBy ? { decided_by: a.decidedBy } : {}) },
    created_at: iso(a.createdAt),
    updated_at: iso(a.decidedAt ?? a.createdAt),
  };
  const failed = (message: string) => ({ ...base, status: "failed", error: { code: "forbidden", message, effect: "none" } });
  if (expired) return failed("No member approved this call in time, so nothing ran. Send it with a new key.");
  if (a.status === "denied") return failed("A member declined this call, so nothing ran and nothing was charged.");
  if (a.status === "cancelled") return { ...base, status: "cancelled" };
  if (a.status === "approved") return { ...base, status: "done", result: { status: "sent" } };
  return { ...base, status: "running" };
}

/** A drop-in `fetch` that answers like the Pramaan API. */
export async function fakePramaanFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const s = fakeState();
  const method = (init.method ?? "GET").toUpperCase();
  const u = new URL(url);
  const path = u.pathname;
  const headers = Object.fromEntries(new Headers(init.headers).entries());
  const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
  s.requests.push({ method, path, headers, body });

  const f = s.failures.findIndex((x) => x.method === method && x.path === path);
  if (f >= 0) {
    const [failure] = s.failures.splice(f, 1);
    return json(failure.status, { error: failure.error });
  }
  if (headers.authorization !== "Bearer fake") return fail(401, "unauthorized", "Send your API key as a Bearer token.");

  const now = s.now();
  if (method === "GET" && path === "/v1/members") return json(200, { results: s.members });

  let m = path.match(/^\/v1\/capabilities\/([^/]+)$/);
  if (method === "GET" && m) {
    const extra = catalogueDescribe(decodeURIComponent(m[1]));
    const c = s.capabilities[decodeURIComponent(m[1])] ?? extra;
    if (!c) return fail(404, "not_found", "No capability with that id. List them with GET /v1/capabilities.");
    return json(200, { id: decodeURIComponent(m[1]), mode: "sync", available: true, needs_connection: true, request_schema: {}, result_schema: {}, ...c, ...extra });
  }

  if (method === "GET" && path === "/v1/approvals") {
    const pending = [...s.approvals.values()].filter((a) => a.status === "pending" && a.expiresAt > now);
    return json(200, { results: pending.sort((a, b) => b.createdAt - a.createdAt).map(summary) });
  }

  m = path.match(/^\/v1\/approvals\/([^/]+)(\/decide)?$/);
  if (m) {
    const a = s.approvals.get(decodeURIComponent(m[1]));
    if (method === "GET" && !m[2]) {
      if (!a) return fail(404, "not_found", "Approval not found. Check the approval_id.");
      return json(200, { ...summary(a), job: job(a, now) });
    }
    if (method === "POST" && m[2]) {
      const member = s.members.find((x) => x.member_id === headers["pramaan-member"]);
      if (!member)
        return fail(403, "forbidden", "Only a member signed in to this workspace can see or decide approvals; keys and apps cannot.");
      if (!member.may_approve) return fail(403, "forbidden", "This member may not approve calls. Ask an approver.");
      const decision = (body as { decision?: unknown } | undefined)?.decision;
      if (decision !== "approve" && decision !== "deny")
        return fail(400, "invalid_request", 'Send {"decision": "approve"} or {"decision": "deny"}.');
      if (!a) return fail(404, "not_found", "Approval not found. Check the approval_id.");
      if (a.status !== "pending" || a.expiresAt <= now)
        return fail(409, "conflict", "This approval was already decided, or it has expired.");
      const status = decision === "approve" ? "approved" : "denied";
      Object.assign(a, { status, decidedBy: member.member_id, decidedAt: now });
      if (status === "approved") a.runs++;
      return json(200, { approval_id: a.id, status: a.status, job: job(a, now) });
    }
  }
  const ctx: FakeCtx = { s, method, path, url: u, headers, body, now, json, fail, addApproval: (a) => addTo(s, a) };
  return platformRoutes(ctx) ?? assessmentRoutes(ctx) ?? memoryRoutes(ctx) ?? consentRoutes(ctx) ?? activityRoutes(ctx) ?? wave3Routes(ctx) ?? catalogueRoutes(ctx) ?? fail(404, "not_found", "No such route.");
}
