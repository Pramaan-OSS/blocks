import "server-only";
import { PramaanError } from "@pramaan/sdk";
import { capability, pramaan } from "@/lib/pramaan/server";

// Server half of the assessment block. Exams, questions, invitations, results and integrity
// reports are superpowers (assessment.*); invitations are delivered with email.send. The candidate
// takes the test on the engine's hosted page, reached by the link; this block has no test screen.

export interface ExamSettings {
  readonly title: string;
  readonly description?: string;
  readonly durationMinutes: number;
  readonly passScore?: number;
  readonly proctoring: { readonly enabled: boolean; readonly profile?: "observe" | "record" | "verify" | "secure" };
  readonly identityRequired: boolean;
  readonly status: "draft" | "active" | "archived";
}

export interface ExamRow extends ExamSettings {
  readonly ref?: string;
  readonly questionCount: number;
}

export interface Question {
  readonly text: string;
  readonly points?: number;
  readonly required?: boolean;
  readonly type: string;
  readonly content: {
    readonly options?: readonly { readonly text: string; readonly isCorrect: boolean }[];
    readonly allowMultiple?: boolean;
    readonly maxWords?: number;
    readonly rubric?: string;
  };
  readonly order: number;
}

export type InviteStatus = "pending" | "opened" | "started" | "completed" | "expired" | "revoked";

export interface Invitation {
  readonly ref?: string;
  readonly status: InviteStatus;
  readonly expiresAt: string;
  readonly createdAt: string;
  readonly emailedAt?: string;
  readonly revokedAt?: string;
}

export interface Session {
  readonly status: string;
  readonly attemptStatus: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly evidenceStatus: string;
}

export interface ResultRow {
  readonly order: number | null;
  readonly question?: string;
  readonly method: string | null;
  readonly isCorrect: boolean | null;
  readonly pointsAwarded: number;
  readonly pointsPossible: number;
  readonly rationale: string | null;
}

export interface Result {
  readonly completedAt?: string;
  readonly grading?: readonly ResultRow[];
  readonly score: number | null;
  readonly passed: boolean | null;
  readonly gradingStatus: "pending" | "partial" | "complete" | "other";
  readonly finalizationStatus: "pending_verdict" | "final" | "other";
  readonly integrityVerdict: string | null;
  readonly proctoringRisk: string;
  readonly trustScore: number | null;
}

export interface Integrity {
  readonly finalizedAt?: string;
  readonly verdict: "clean" | "flagged" | "terminated" | "indeterminate" | "other";
  readonly integrityScore: number;
  readonly signals: readonly { readonly type: string; readonly severity: string; readonly count: number }[];
  readonly coverage: { readonly heartbeatPct: number; readonly evidenceComplete: boolean; readonly sufficient?: boolean };
}

/** What one candidate got when invited. `emailed` says what happened to the message. */
export interface InviteOutcome {
  readonly email: string;
  readonly ref?: string;
  readonly link?: string;
  readonly created?: boolean;
  readonly emailed: "not_requested" | "sent" | "waiting_for_approval" | "failed";
  readonly error?: { readonly code: string; readonly message: string; readonly next?: string };
}

export type Delivery =
  | { readonly mode: "link" }
  | {
      readonly mode: "email";
      /** "own": the person's connected Gmail or Outlook. "domain": a domain you verified. */
      readonly sender: "own" | "domain";
      readonly from?: string;
      readonly subject: string;
      /** The message. `{link}` is replaced by the candidate's link; without it the link is added at the end. */
      readonly message: string;
    };

const bad = (message: string) => new PramaanError("invalid_request", message, { status: 400 });

const refOf = (ref: string) => {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(ref)) throw bad("That reference isn't valid.");
  return ref;
};

export const listExams = () => capability<{ results: ExamRow[] }>("assessment.exams.list", {});

export async function getExam(ref: string) {
  const [exam, questions] = await Promise.all([
    capability<ExamSettings>("assessment.exam.get", { ref: refOf(ref) }),
    capability<{ results: Question[] }>("assessment.questions.list", { ref }),
  ]);
  return { ref, ...exam, questions: [...questions.results].sort((a, b) => a.order - b.order) };
}

export function createExam(body: Record<string, unknown>) {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) throw bad("Give the exam a title.");
  const minutes = Number(body.durationMinutes);
  if (!Number.isFinite(minutes) || minutes < 1) throw bad("Give the exam a length in minutes, 1 or more.");
  const pass = body.passScore === undefined || body.passScore === "" ? undefined : Number(body.passScore);
  if (pass !== undefined && (!Number.isFinite(pass) || pass < 0 || pass > 100)) throw bad("The pass score is a number from 0 to 100.");
  const proctoring = body.proctoring as { enabled?: unknown; profile?: unknown } | undefined;
  return capability<ExamSettings & { ref?: string }>("assessment.exam.create", {
    title,
    ...(typeof body.description === "string" && body.description.trim() ? { description: body.description.trim() } : {}),
    durationMinutes: minutes,
    ...(pass !== undefined ? { passScore: pass } : {}),
    proctoring: proctoring?.enabled ? { enabled: true, profile: proctoring.profile ?? "record" } : { enabled: false },
    identityRequired: body.identityRequired === true,
  });
}

export function addQuestion(ref: string, body: Record<string, unknown>) {
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) throw bad("Write the question.");
  const points = body.points === undefined || body.points === "" ? undefined : Number(body.points);
  if (points !== undefined && (!Number.isFinite(points) || points < 0)) throw bad("Points is a number, 0 or more.");
  const common = { ref: refOf(ref), text, ...(points !== undefined ? { points } : {}), required: body.required !== false };
  if (body.type === "mcq") {
    const options = (Array.isArray(body.options) ? body.options : []) as { text?: unknown; isCorrect?: unknown }[];
    const clean = options.map((o) => ({ text: String(o.text ?? "").trim(), isCorrect: o.isCorrect === true })).filter((o) => o.text);
    if (clean.length < 2) throw bad("Give a multiple-choice question at least two options.");
    const correct = clean.filter((o) => o.isCorrect).length;
    if (correct === 0) throw bad("Mark at least one option as correct.");
    return capability<{ created: boolean }>("assessment.question.create", { ...common, type: "mcq", content: { options: clean, allowMultiple: correct > 1 } });
  }
  if (body.type === "text") {
    const maxWords = Number(body.maxWords ?? 200);
    if (!Number.isFinite(maxWords) || maxWords < 1) throw bad("Max words is a number, 1 or more.");
    const rubric = typeof body.rubric === "string" && body.rubric.trim() ? { rubric: body.rubric.trim() } : {};
    return capability<{ created: boolean }>("assessment.question.create", { ...common, type: "text", content: { maxWords, ...rubric } });
  }
  throw bad("Choose a question type: multiple choice or written answer.");
}

export const publishExam = (ref: string) => capability<{ status: string }>("assessment.exam.publish", { ref: refOf(ref) });

/** The most one action costs, so the confirm can show it. */
const PRICED = new Set(["assessment.exam.publish", "assessment.invitation.create", "assessment.invitation.revoke", "email.send"]);
export function estimateAction(body: Record<string, unknown>) {
  const id = body.capability;
  if (typeof id !== "string" || !PRICED.has(id)) throw bad("That action has no price to show here.");
  return pramaan<{ price_max_micro: number }>(`/v1/capabilities/${id}/estimate`, { method: "POST", body: body.input ?? {} });
}

export const listInvitations = (ref: string) =>
  capability<{ results: Invitation[] }>("assessment.invitations.list", { ref: refOf(ref) });

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Invite email never leaves from a Pramaan address: your own Gmail or Outlook, or a domain you verified. */
function checkDelivery(d: Delivery) {
  if (d.mode === "link") return;
  if (!d.subject?.trim() || !d.message?.trim()) throw bad("Write a subject and a message for the invitation email.");
  if (d.sender === "domain") {
    const domain = d.from?.split("@")[1] ?? "";
    if (!EMAIL.test(d.from ?? "")) throw bad("Give the from address, on a domain you verified.");
    if (/(^|\.)pramaan\./i.test(domain)) throw bad("Invitations send from your own Gmail or Outlook, or a domain you verified, never a Pramaan address.");
  } else if (d.sender !== "own") throw bad("Choose where the email is sent from.");
}

/**
 * Creates one invitation per candidate and, for email delivery, sends each its own link. `key` is
 * the person's one click: every call carries a key made from it, so a repeat never invites twice.
 * One candidate failing doesn't stop the others.
 */
export async function invite(ref: string, body: { emails?: unknown; delivery?: Delivery }, key: string): Promise<{ results: InviteOutcome[] }> {
  refOf(ref);
  const list = [...new Set((Array.isArray(body.emails) ? body.emails : []).map((e) => String(e).trim().toLowerCase()).filter(Boolean))];
  if (list.length === 0) throw bad("Add at least one candidate email.");
  if (list.length > 50) throw bad("Invite up to 50 candidates at a time.");
  const wrong = list.find((e) => !EMAIL.test(e));
  if (wrong) throw bad(`"${wrong}" isn't an email address.`);
  const delivery = body.delivery ?? { mode: "link" as const };
  checkDelivery(delivery);

  const results: InviteOutcome[] = [];
  for (const email of list) {
    const fail = (error: unknown, link?: string, ref?: string): InviteOutcome => {
      const e = error instanceof PramaanError ? error : undefined;
      return { email, ...(ref ? { ref } : {}), ...(link ? { link } : {}), emailed: "failed", error: { code: e?.code ?? "internal", message: e?.message ?? "Something went wrong. Try again.", ...((e as { next?: string } | undefined)?.next ? { next: (e as { next?: string }).next } : {}) } };
    };
    let created: { link: string; created: boolean; ref?: string };
    try {
      created = await capability("assessment.invitation.create", { ref, email }, { "Idempotency-Key": `${key}:${email}` });
    } catch (e) {
      results.push(fail(e));
      continue;
    }
    const base = { email, link: created.link, created: created.created, ...(created.ref ? { ref: created.ref } : {}) };
    if (delivery.mode === "link") {
      results.push({ ...base, emailed: "not_requested" });
      continue;
    }
    const text = delivery.message.includes("{link}") ? delivery.message.replaceAll("{link}", created.link) : `${delivery.message}\n\n${created.link}`;
    try {
      const sent = await pramaan<{ status?: string }>("/v1/capabilities/email.send", {
        method: "POST",
        body: { to: email, subject: delivery.subject.trim(), text, ...(delivery.sender === "domain" ? { sender: "domain", from: delivery.from } : {}) },
        headers: { "Idempotency-Key": `${key}:${email}:mail` },
      });
      // A send made with a key waits for a member's approval (202, a running job).
      results.push({ ...base, emailed: sent.status === "running" ? "waiting_for_approval" : "sent" });
    } catch (e) {
      results.push({ ...fail(e, created.link, created.ref) });
    }
  }
  return { results };
}

export async function getInvitation(ref: string) {
  const [invitation, session] = await Promise.all([
    capability<Invitation>("assessment.invitation.get", { ref: refOf(ref) }),
    capability<Session>("assessment.session.get", { ref }),
  ]);
  return { ref, ...invitation, session };
}

/** Withdraws an unused invitation. It needs a member's approval: 202 means it now waits in the inbox. */
export async function revokeInvitation(ref: string, key: string) {
  const res = await capability<{ status: string; revokedAt?: string | null }>("assessment.invitation.revoke", { ref: refOf(ref) }, { "Idempotency-Key": key });
  return res.status === "running" ? { status: "waiting_for_approval" as const } : { status: "revoked" as const };
}

export const getResult = (ref: string) => capability<Result>("assessment.result.get", { ref: refOf(ref) });

export const getIntegrity = (ref: string) => capability<Integrity>("assessment.integrity-report.get", { ref: refOf(ref) });
