import type { FakeCtx, FakeState } from "./fake";
import { platform } from "./fake-platform";

// Fake exams, invitations, results and integrity reports (assessment.* superpowers) plus the
// email.send that delivers an invitation, with the documented shapes. Extends the core fake.
//
// Publish runs at once. Revoke and email.send wait for a member's approval in the approvals
// inbox, as a call made with a key does; they take effect once it is approved. Revoking an
// invitation releases the credit held for it.

const DAY = 86_400_000;
const HOLD_MICRO = 500_000;

type ExamStatus = "draft" | "active" | "archived";
type InviteStatus = "pending" | "opened" | "started" | "completed" | "expired" | "revoked";

interface Question {
  text: string;
  points?: number;
  required?: boolean;
  type: string;
  content: unknown;
  order: number;
}

interface Exam {
  ref: string;
  title: string;
  description?: string;
  durationMinutes: number;
  passScore?: number;
  proctoring: { enabled: boolean; profile?: string };
  identityRequired: boolean;
  status: ExamStatus;
  questions: Question[];
}

interface Invite {
  ref: string;
  examRef: string;
  email: string;
  status: InviteStatus;
  createdAt: number;
  expiresAt: number;
  emailedAt?: number;
  revokedAt?: number;
  link: string;
  revokeApproval?: string;
  /** The result and integrity report exist only once grading has finished. */
  ready: boolean;
  score?: number;
  flagged?: boolean;
}

interface Email {
  approval: string;
  to: string[];
  text: string;
  applied: boolean;
}

export interface AssessmentState {
  exams: Map<string, Exam>;
  invites: Map<string, Invite>;
  idem: Map<string, string>;
  emails: Email[];
  /** Emails that went out, after approval. */
  sent: { to: string[]; text: string }[];
  seq: number;
}

const iso = (ms: number) => new Date(ms).toISOString();

function seedAssessment(s: FakeState): AssessmentState {
  const now = s.now();
  const st: AssessmentState = { exams: new Map(), invites: new Map(), idem: new Map(), emails: [], sent: [], seq: 0 };
  const q = (text: string, type = "mcq", order = 0): Question => ({
    text,
    type,
    points: 5,
    required: true,
    order,
    content:
      type === "mcq"
        ? { options: [{ text: "Yes", isCorrect: true }, { text: "No", isCorrect: false }], allowMultiple: false }
        : { maxWords: 200, rubric: "Clear, correct, short." },
  });
  st.exams.set("exm_active1", {
    ref: "exm_active1",
    title: "Backend engineer screen",
    description: "Forty minutes: HTTP, SQL and one design question.",
    durationMinutes: 40,
    passScore: 70,
    proctoring: { enabled: true, profile: "record" },
    identityRequired: true,
    status: "active",
    questions: [q("Is a PUT request idempotent?", "mcq", 1), q("Does an index always speed up a query?", "mcq", 2), q("Explain how you would page a large result set.", "text", 3)],
  });
  st.exams.set("exm_draft1", {
    ref: "exm_draft1",
    title: "Customer support quiz",
    durationMinutes: 20,
    proctoring: { enabled: false },
    identityRequired: false,
    status: "draft",
    questions: [q("Should you apologise before you know the cause?", "mcq", 1)],
  });
  const invite = (ref: string, email: string, status: InviteStatus, extra: Partial<Invite> = {}) =>
    st.invites.set(ref, { ref, examRef: "exm_active1", email, status, createdAt: now - 3 * DAY, expiresAt: now + 7 * DAY, link: `https://tests.example.com/i/${ref}`, ready: false, ...extra });
  invite("inv_ada", "ada@example.com", "pending", { emailedAt: now - 3 * DAY });
  invite("inv_grace", "grace@example.com", "started", { emailedAt: now - 2 * DAY });
  invite("inv_alan", "alan@example.com", "completed", { emailedAt: now - 2 * DAY, ready: true, score: 82 });
  invite("inv_linus", "linus@example.com", "expired", { createdAt: now - 20 * DAY, expiresAt: now - 10 * DAY, emailedAt: now - 20 * DAY });
  for (const i of st.invites.values()) if (i.status === "pending" || i.status === "opened" || i.status === "started") s.holds.set(`invite:${i.ref}`, HOLD_MICRO);
  return st;
}

const assessment = (s: FakeState): AssessmentState => (s.assessment ??= seedAssessment(s));

/** The candidate finishes and grading ends: results and integrity become readable. */
export function finishInvitation(s: FakeState, ref: string, score = 76, flagged = false): void {
  const i = assessment(s).invites.get(ref);
  if (!i) return;
  Object.assign(i, { status: "completed", ready: true, score, flagged });
  s.holds.delete(`invite:${ref}`);
}

/** Applies approvals that have been decided: revokes and emails take effect. */
function sweep(c: FakeCtx): AssessmentState {
  const st = assessment(c.s);
  for (const i of st.invites.values()) {
    if ((i.status === "pending" || i.status === "opened") && i.expiresAt <= c.now) i.status = "expired";
    const a = i.revokeApproval ? c.s.approvals.get(i.revokeApproval) : undefined;
    if (a?.status === "approved" && i.status !== "revoked") {
      i.status = "revoked";
      i.revokedAt = a.decidedAt ?? c.now;
      c.s.holds.delete(`invite:${i.ref}`);
    } else if (a && a.status !== "pending" && a.status !== "approved") i.revokeApproval = undefined;
    if (i.status === "expired") c.s.holds.delete(`invite:${i.ref}`);
  }
  for (const e of st.emails) {
    if (e.applied || c.s.approvals.get(e.approval)?.status !== "approved") continue;
    e.applied = true;
    st.sent.push({ to: e.to, text: e.text });
    for (const i of st.invites.values()) if (e.to.includes(i.email) && e.text.includes(i.link)) i.emailedAt = c.now;
  }
  return st;
}

const examView = (e: Exam) => ({
  title: e.title,
  ...(e.description ? { description: e.description } : {}),
  durationMinutes: e.durationMinutes,
  ...(e.passScore !== undefined ? { passScore: e.passScore } : {}),
  proctoring: e.proctoring,
  identityRequired: e.identityRequired,
  status: e.status,
});

const inviteView = (i: Invite) => ({
  status: i.status,
  link: i.link,
  expiresAt: iso(i.expiresAt),
  createdAt: iso(i.createdAt),
  ...(i.emailedAt ? { emailedAt: iso(i.emailedAt) } : {}),
  ...(i.revokedAt ? { revokedAt: iso(i.revokedAt) } : {}),
});

const PRICES: Record<string, number> = {
  "assessment.exam.publish": 13_000,
  "assessment.invitation.create": 13_000 + HOLD_MICRO,
  "assessment.invitation.revoke": 0,
  "email.send": 2_000,
};

const notReady = (c: FakeCtx) => c.fail(404, "not_found", "Not ready yet. Grading is still running; try again in a minute.");

function capability(c: FakeCtx, id: string): Response | undefined {
  const st = sweep(c);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = (c.body ?? {}) as Record<string, any>;
  const exam = typeof b.ref === "string" ? st.exams.get(b.ref) : undefined;
  const invite = typeof b.ref === "string" ? st.invites.get(b.ref) : undefined;
  const needExam = () => (exam ? undefined : c.fail(404, "not_found", "No exam with that ref. List yours with assessment.exams.list."));
  const needInvite = () => (invite ? undefined : c.fail(404, "not_found", "No invitation with that ref. List them with assessment.invitations.list."));

  switch (id) {
    case "assessment.exams.list": {
      const rows = [...st.exams.values()].filter((e) => !b.status || e.status === b.status);
      return c.json(200, { results: rows.map((e) => ({ ...examView(e), ref: e.ref, questionCount: e.questions.length })) });
    }
    case "assessment.exam.get":
      return needExam() ?? c.json(200, examView(exam!));
    case "assessment.exam.create": {
      if (!b.title || !b.durationMinutes || !b.proctoring) return c.fail(400, "invalid_request", "Send title, durationMinutes and proctoring.");
      const ref = `exm_fake${String(++st.seq).padStart(4, "0")}`;
      const e: Exam = { ref, title: b.title, description: b.description, durationMinutes: b.durationMinutes, passScore: b.passScore, proctoring: b.proctoring, identityRequired: !!b.identityRequired, status: "draft", questions: [] };
      st.exams.set(ref, e);
      return c.json(200, { ...examView(e), ref });
    }
    case "assessment.question.create": {
      const bad = needExam();
      if (bad) return bad;
      if (exam!.status !== "draft") return c.fail(409, "conflict", "This exam is published, so its questions are frozen.");
      if (!b.text || !b.type || !b.content) return c.fail(400, "invalid_request", "Send text, type and content.");
      exam!.questions.push({ text: b.text, points: b.points, required: b.required, type: b.type, content: b.content, order: exam!.questions.length + 1 });
      return c.json(200, { created: true });
    }
    case "assessment.questions.list":
      return needExam() ?? c.json(200, { results: exam!.questions });
    case "assessment.exam.publish": {
      const bad = needExam();
      if (bad) return bad;
      if (exam!.status !== "draft") return c.fail(409, "conflict", "This exam is already published and cannot go back to draft.");
      if (exam!.questions.length === 0) return c.fail(409, "conflict", "Add at least one question before publishing.");
      exam!.status = "active";
      return c.json(200, { status: "active" });
    }
    case "assessment.invitation.create": {
      const bad = needExam();
      if (bad) return bad;
      const key = c.headers["idempotency-key"];
      if (!key) return c.fail(400, "invalid_request", "Send an Idempotency-Key header: this call needs a retry key.");
      if (exam!.status !== "active") return c.fail(409, "conflict", "Publish the exam before inviting candidates.");
      const prior = st.idem.get(key);
      if (prior) {
        const i = st.invites.get(prior)!;
        return c.json(200, { link: i.link, expiresAt: iso(i.expiresAt), created: false, ref: i.ref });
      }
      const p = platform(c.s);
      const available = p.balanceMicro - [...c.s.holds.values()].reduce((n, x) => n + x, 0);
      if (available < HOLD_MICRO)
        return c.json(402, { error: { code: "spend_cap_reached", reason: "balance", message: "Your balance is too low to hold credit for this session. Add credit, then try again.", effect: "none", top_up: { message: "Add credit, then try again.", links: [{ label: "Add credit", url: "https://app.pramaan.dev/settings/wallet" }], required_micro: HOLD_MICRO, balance_micro: available } } });
      const ref = `inv_fake${String(++st.seq).padStart(4, "0")}`;
      const i: Invite = { ref, examRef: exam!.ref, email: String(b.email), status: "pending", createdAt: c.now, expiresAt: c.now + 10 * DAY, link: `https://tests.example.com/i/${ref}`, ready: false };
      st.invites.set(ref, i);
      st.idem.set(key, ref);
      c.s.holds.set(`invite:${ref}`, HOLD_MICRO);
      return c.json(200, { link: i.link, expiresAt: iso(i.expiresAt), created: true, ref });
    }
    case "assessment.invitations.list": {
      const bad = needExam();
      if (bad) return bad;
      const rows = [...st.invites.values()].filter((i) => i.examRef === exam!.ref && (!b.status || i.status === b.status));
      return c.json(200, { results: rows.sort((x, y) => y.createdAt - x.createdAt).map((i) => ({ ...inviteView(i), ref: i.ref })) });
    }
    case "assessment.invitation.get":
      return needInvite() ?? c.json(200, inviteView(invite!));
    case "assessment.session.get": {
      const bad = needInvite();
      if (bad) return bad;
      const state = invite!.status;
      return c.json(200, {
        environment: "test",
        status: state === "completed" ? "completed" : state === "started" ? "in_progress" : state === "expired" ? "expired" : "invited",
        attemptStatus: state === "completed" ? "graded" : state === "started" ? "in_progress" : state === "expired" ? "expired" : null,
        startedAt: state === "started" || state === "completed" ? iso(invite!.createdAt + 3_600_000) : null,
        completedAt: state === "completed" ? iso(invite!.createdAt + 7_200_000) : null,
        evidenceStatus: invite!.ready ? "complete" : "pending",
      });
    }
    case "assessment.invitation.revoke": {
      const bad = needInvite();
      if (bad) return bad;
      if (invite!.status === "revoked") return c.json(200, { status: "revoked", revokedAt: iso(invite!.revokedAt ?? c.now) });
      if (invite!.status !== "pending" && invite!.status !== "opened")
        return c.fail(409, "conflict", "This candidate already started or the invitation ended, so it can't be withdrawn.");
      invite!.revokeApproval ??= c.addApproval({ capability: id, priceMicro: 0, input: { ref: invite!.ref, email: invite!.email }, requestedBy: { kind: "key" }, createdAt: c.now });
      return c.json(202, { job_id: invite!.revokeApproval, status: "running", held_micro: 0 });
    }
    case "assessment.result.get": {
      const bad = needInvite();
      if (bad) return bad;
      if (!invite!.ready) return notReady(c);
      const score = invite!.score ?? 0;
      const exam2 = st.exams.get(invite!.examRef)!;
      return c.json(200, {
        completedAt: iso(invite!.createdAt + 7_200_000),
        environment: "test",
        grading: exam2.questions.map((q, n) => ({ order: n + 1, question: q.text, method: q.type === "mcq" ? "mcq_sync" : "ai_async", isCorrect: q.type === "mcq" ? true : null, pointsAwarded: q.type === "mcq" ? (q.points ?? 0) : Math.round((q.points ?? 0) * 0.6), pointsPossible: q.points ?? 0, rationale: q.type === "mcq" ? null : "Covers cursors but not stable ordering." })),
        score,
        passed: score >= (exam2.passScore ?? 0),
        gradingStatus: "complete",
        finalizationStatus: "final",
        revision: 1,
        integrityVerdict: invite!.flagged ? "flagged" : "clean",
        proctoringRisk: invite!.flagged ? "high" : "low",
        trustScore: invite!.flagged ? 41 : 93,
      });
    }
    case "assessment.integrity-report.get": {
      const bad = needInvite();
      if (bad) return bad;
      if (!invite!.ready) return notReady(c);
      return c.json(200, {
        finalizedAt: iso(invite!.createdAt + 7_300_000),
        revision: { status: "current", isCurrent: true },
        verdict: invite!.flagged ? "flagged" : "clean",
        integrityScore: invite!.flagged ? 41 : 93,
        signals: invite!.flagged
          ? [{ type: "tab_switch", severity: "high", count: 9 }, { type: "multiple_faces", severity: "critical", count: 2 }]
          : [{ type: "tab_switch", severity: "low", count: 1 }],
        coverage: { heartbeatPct: 98, evidenceComplete: true, sufficient: true },
      });
    }
    case "email.send": {
      const to = ([] as string[]).concat(b.to ?? []);
      if (to.length === 0 || !b.subject) return c.fail(400, "invalid_request", "Send to and subject.");
      if (b.sender === "domain" && !b.from) return c.fail(400, "invalid_request", 'With sender "domain", send a from address on a domain you verified.');
      const key = c.headers["idempotency-key"];
      const prior = key ? st.idem.get(`mail:${key}`) : undefined;
      if (prior) return c.json(202, { job_id: prior, status: "running", held_micro: 0 });
      const approval = c.addApproval({ capability: id, priceMicro: PRICES[id], input: b, requestedBy: { kind: "key" }, createdAt: c.now });
      if (key) st.idem.set(`mail:${key}`, approval);
      st.emails.push({ approval, to, text: String(b.text ?? ""), applied: false });
      return c.json(202, { job_id: approval, status: "running", held_micro: 0 });
    }
  }
  return undefined;
}

/** The assessment routes of this fake. Returns undefined for a route it doesn't serve. */
export function assessmentRoutes(c: FakeCtx): Response | undefined {
  const m = c.path.match(/^\/v1\/capabilities\/([^/]+?)(\/estimate)?$/);
  if (c.method !== "POST" || !m) return undefined;
  const id = decodeURIComponent(m[1]);
  if (m[2]) return id in PRICES ? c.json(200, { price_max_micro: PRICES[id] }) : undefined;
  return capability(c, id);
}

/** The emails that went out after approval, for tests. */
export const sentEmails = (s: FakeState) => sweepAll(s).sent;

function sweepAll(s: FakeState): AssessmentState {
  // Same as a route call: applies decided approvals before reading.
  const noop = (): Response => new Response(null);
  return sweep({ s, method: "GET", path: "", url: new URL("http://fake"), headers: {}, body: undefined, now: s.now(), json: noop, fail: noop, addApproval: () => "" });
}

/** Invitations and emails, brought up to date, for tests that read state directly. */
export const assessmentState = sweepAll;
