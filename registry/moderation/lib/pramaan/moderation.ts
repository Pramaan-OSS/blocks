import "server-only";
import { randomUUID } from "node:crypto";
import { crmDatabase, fakeRows, text, CrmProblem } from "@/lib/pramaan/crm-data";
import { capability } from "@/lib/pramaan/server";
import { mayModerate, moderationSubject, socialScope } from "@/lib/pramaan/social-context";
export type Target = { kind: "item" | "person"; ref: string };
export type Report = Target & { id: string; reason: string; by: string; at: string; status: "open" | "hidden" | "dismissed"; automatic: boolean; decidedBy?: string; decidedAt?: string };
/** What reviewers receive: plain labels, without member or content references. */
export type QueueReport = Pick<Report, "id" | "kind" | "reason" | "at" | "status" | "automatic" | "decidedAt"> & { reviewer?: "you" | "another moderator"; subject?: { label: string; href?: string; excerpt?: string } };
export type ModerationData = { reports: QueueReport[] };
export type AuditEntry = { action: "hide" | "dismiss"; by: string; at: string; target: Target };
type Scoped<T> = T & { scope: string };
/** Reviewers see open reports first, then the most recent decisions. */
const QUEUE_LIMIT = 200;
const isFake = () => process.env.PRAMAAN_FAKE === "1";
const iso = (value: Date | string | null) => value === null ? undefined : new Date(value).toISOString();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function targetOf(body: Record<string, unknown>): Target {
  if (body.kind !== "item" && body.kind !== "person") throw new CrmProblem("Choose an item or person.");
  return { kind: body.kind, ref: text(body.ref, "a reference", 200) };
}
export async function isBlocked(viewer: string | undefined, other: string, scope = socialScope()) {
  if (!viewer) return false;
  if (isFake()) return fakeRows<Scoped<{ viewer: string; other: string }>>("crm_block").some(b => b.scope === scope && b.viewer === viewer && b.other === other);
  return (await crmDatabase()`select 1 from crm_block where scope = ${scope} and viewer = ${viewer} and other = ${other}`).length > 0;
}
export async function isHidden(ref: string, scope = socialScope()) {
  if (isFake()) return fakeRows<Scoped<{ ref: string }>>("crm_hidden_item").some(h => h.scope === scope && h.ref === ref);
  return (await crmDatabase()`select 1 from crm_hidden_item where scope = ${scope} and ref = ${ref}`).length > 0;
}
export async function reportTarget(scope: string, by: string, target: Target, reason: string, automatic = false) {
  const why = text(reason, "a reason", 1000);
  if (isFake()) {
    const reports = fakeRows<Scoped<Report>>("crm_report");
    if (reports.some(r => r.scope === scope && r.by === by && r.kind === target.kind && r.ref === target.ref && r.status === "open")) return;
    reports.push({ scope, ...target, id: randomUUID(), by, reason: why, at: new Date().toISOString(), status: "open", automatic });
    return;
  }
  // The partial unique index keeps one open report per reporter and target, even under races.
  await crmDatabase()`insert into crm_report (id, scope, kind, ref, reason, reported_by, automatic)
    values (${randomUUID()}, ${scope}, ${target.kind}, ${target.ref}, ${why}, ${by}, ${automatic})
    on conflict (scope, reported_by, kind, ref) where status = 'open' do nothing`;
}
function refuseDecision(report: { kind: string; status: string } | undefined, action: "hide" | "dismiss") {
  if (!report) throw new CrmProblem("This report is no longer available.", 404);
  if (report.status !== "open") throw new CrmProblem("This report was already reviewed.", 409);
  if (action === "hide" && report.kind !== "item") throw new CrmProblem("Only items can be hidden. Dismiss this report or use your host's account controls.");
}
async function decide(scope: string, member: string, id: string, action: "hide" | "dismiss") {
  const status = action === "hide" ? "hidden" : "dismissed";
  if (isFake()) {
    const report = fakeRows<Scoped<Report>>("crm_report").find(r => r.scope === scope && r.id === id);
    refuseDecision(report, action);
    const at = new Date().toISOString();
    Object.assign(report!, { status, decidedBy: member, decidedAt: at });
    const hidden = fakeRows<Scoped<{ ref: string; by: string; at: string }>>("crm_hidden_item");
    if (action === "hide" && !hidden.some(h => h.scope === scope && h.ref === report!.ref)) hidden.push({ scope, ref: report!.ref, by: member, at });
    fakeRows<Scoped<AuditEntry>>("crm_moderation_audit").push({ scope, action, by: member, at, target: { kind: report!.kind, ref: report!.ref } });
    return;
  }
  await crmDatabase().begin(async tx => {
    // Only an open report changes, so one of two concurrent reviewers wins.
    const [report] = await tx`update crm_report set status = ${status}, decided_by = ${member}, decided_at = now()
      where scope = ${scope} and id = ${id} and status = 'open' and (${action} = 'dismiss' or kind = 'item')
      returning kind, ref, decided_at`;
    if (!report) {
      const [existing] = await tx`select kind, status from crm_report where scope = ${scope} and id = ${id}`;
      refuseDecision(existing as { kind: string; status: string } | undefined, action);
      throw new CrmProblem("This report was already reviewed.", 409);
    }
    if (action === "hide") await tx`insert into crm_hidden_item (scope, ref, hidden_by, hidden_at) values (${scope}, ${report.ref}, ${member}, ${report.decided_at}) on conflict do nothing`;
    await tx`insert into crm_moderation_audit (scope, report_id, action, actor, at, kind, ref) values (${scope}, ${id}, ${action}, ${member}, ${report.decided_at}, ${report.kind}, ${report.ref})`;
  });
}
export async function moderate(scope: string, member: string, body: Record<string, unknown>) {
  if (body.action === "report") {
    await reportTarget(scope, member, targetOf(body), text(body.reason, "a reason", 1000));
    return { message: "Report sent." };
  }
  if (body.action === "block" || body.action === "unblock") {
    const other = text(body.ref, "a person", 200);
    if (other === member) throw new CrmProblem("Choose another person.");
    if (isFake()) {
      const blocks = fakeRows<Scoped<{ viewer: string; other: string }>>("crm_block");
      const at = blocks.findIndex(b => b.scope === scope && b.viewer === member && b.other === other);
      if (at >= 0) blocks.splice(at, 1);
      if (body.action === "block") blocks.push({ scope, viewer: member, other });
    } else if (body.action === "block") {
      await crmDatabase()`insert into crm_block (scope, viewer, other) values (${scope}, ${member}, ${other}) on conflict do nothing`;
    } else {
      await crmDatabase()`delete from crm_block where scope = ${scope} and viewer = ${member} and other = ${other}`;
    }
    return { message: body.action === "block" ? "Person blocked." : "Person unblocked." };
  }
  if (!await mayModerate(member, scope)) throw new CrmProblem("Only owners and admins can review reports.", 403);
  if (body.action !== "hide" && body.action !== "dismiss") throw new CrmProblem("Choose a review action.");
  if (typeof body.id !== "string" || !UUID.test(body.id)) throw new CrmProblem("This report is no longer available.", 404);
  await decide(scope, member, body.id, body.action);
  return { message: "Review saved." };
}
/** Off by default. Classification is advisory: it never hides or deletes content. */
export async function checkNewText(scope: string, target: Target, content: string) {
  if (process.env.PRAMAAN_TEXT_SCREENING !== "1" || !content.trim()) return;
  let reason = "Automatic text check needs a review.";
  try {
    const result = await capability<{ primaryCategory?: string; confidence?: number; allCategories?: { category?: string; confidence?: number }[] }>("text.classify", { text: content });
    const labels = [{ category: result.primaryCategory, confidence: result.confidence }, ...(result.allCategories ?? [])];
    const flagged = labels.some(c => /^(abusive|spam|sexual)$/i.test(c.category ?? "") && typeof c.confidence === "number" && c.confidence >= 0.7);
    const safe = !flagged && labels.some(c => c.category?.toLowerCase() === "safe" && typeof c.confidence === "number" && c.confidence >= 0.7 && c.confidence <= 1);
    if (safe) return;
    if (flagged) reason = "Automatic text check flagged this for review.";
  } catch { /* A failed check stays visible and goes to a person for review. */ }
  await reportTarget(scope, "automatic", target, reason, true);
}

async function recentReports(scope: string): Promise<Report[]> {
  if (isFake()) {
    return fakeRows<Scoped<Report>>("crm_report").filter(r => r.scope === scope).reverse()
      .sort((a, b) => Number(b.status === "open") - Number(a.status === "open") || b.at.localeCompare(a.at)).slice(0, QUEUE_LIMIT).map(r => structuredClone(r));
  }
  // ponytail: one bounded page of 200; add cursor paging when a community keeps more open reports than that.
  const rows = await crmDatabase()`select * from crm_report where scope = ${scope} order by (status = 'open') desc, reported_at desc limit ${QUEUE_LIMIT}`;
  return rows.map(r => ({ id: r.id, kind: r.kind, ref: r.ref, reason: r.reason, by: r.reported_by, at: iso(r.reported_at)!, status: r.status, automatic: r.automatic, decidedBy: r.decided_by ?? undefined, decidedAt: iso(r.decided_at) }));
}
/** Only call after verifying the viewer's moderator role. */
export async function moderationQueue(scope: string, viewer?: string): Promise<ModerationData> {
  const reports = await recentReports(scope);
  return { reports: await Promise.all(reports.map(async r => ({
    id: r.id, kind: r.kind, reason: r.reason, at: r.at, status: r.status, automatic: r.automatic,
    ...(r.decidedAt ? { decidedAt: r.decidedAt, reviewer: r.decidedBy === viewer ? "you" as const : "another moderator" as const } : {}),
    subject: await moderationSubject(r.kind, r.ref, scope),
  }))) };
}
/** Who decided what and when, newest first. Only call after verifying the viewer's moderator role. */
export async function moderationAudit(scope: string, limit = 100): Promise<AuditEntry[]> {
  if (isFake()) return fakeRows<Scoped<AuditEntry>>("crm_moderation_audit").filter(a => a.scope === scope).reverse().slice(0, limit).map(({ scope: _scope, ...entry }) => structuredClone(entry));
  const rows = await crmDatabase()`select action, actor, at, kind, ref from crm_moderation_audit where scope = ${scope} order by at desc, id desc limit ${limit}`;
  return rows.map(r => ({ action: r.action, by: r.actor, at: iso(r.at)!, target: { kind: r.kind, ref: r.ref } }));
}
