import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeCrmDatabase } from "@/lib/pramaan/crm-data";
import { saveProfile, ownProfile, publicProfile } from "@/lib/pramaan/profiles";
import * as context from "@/lib/pramaan/social-context";
import { isBlocked, isHidden, moderate, moderationAudit, moderationQueue, reportTarget } from "@/lib/pramaan/moderation";
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("B1 real Postgres", () => {
  const scope = `b1-${randomUUID()}`;
  let db: ReturnType<typeof postgres>;
  const body = { revision: 0, name: "Jamie", bio: "Private", links: ["https://example.com/"], public: { name: true, bio: false, links: false, photo: false } };
  beforeAll(async () => {
    vi.stubEnv("PRAMAAN_FAKE", "0"); vi.stubEnv("PRAMAAN_TEXT_SCREENING", ""); vi.stubEnv("DATABASE_URL", url!);
    vi.spyOn(context, "mayModerate").mockImplementation(async member => ["owner", "admin"].includes(member));
    db = postgres(url!, { max: 5, prepare: false });
    // Apply every numbered migration in order, twice, as an installed host would.
    for (const block of ["profiles", "moderation"]) {
      const dir = `registry/${block}/src/db/migrations`;
      for (const file of (await readdir(dir)).sort()) {
        const sql = await readFile(`${dir}/${file}`, "utf8");
        await db.unsafe(sql); await db.unsafe(sql);
      }
    }
  });
  afterAll(async () => {
    try { for (const table of ["crm_moderation_audit", "crm_report", "crm_block", "crm_hidden_item", "crm_profile"]) await db.unsafe(`delete from ${table} where scope = $1`, [scope]); }
    finally { await closeCrmDatabase(); await db?.end(); vi.restoreAllMocks(); vi.unstubAllEnvs(); }
  });
  it("stores one row per profile and rejects one of two concurrent stale edits", async () => {
    const first = await Promise.allSettled([saveProfile(scope, "person-one", body), saveProfile(scope, "person-one", { ...body, name: "Rival" })]);
    expect(first.filter(e => e.status === "fulfilled")).toHaveLength(1);
    const edits = await Promise.allSettled([saveProfile(scope, "person-one", { ...body, revision: 1, name: "First" }), saveProfile(scope, "person-one", { ...body, revision: 1, name: "Second" })]);
    expect(edits.filter(e => e.status === "fulfilled")).toHaveLength(1);
    expect(edits.filter(e => e.status === "rejected")).toHaveLength(1);
    expect((await ownProfile(scope, "person-one")).revision).toBe(2);
    expect(Object.keys(await publicProfile(scope, "person-one"))).toEqual(["name"]);
    await saveProfile(scope, "person-two", body);
    const rows = await db`select person, revision, public_bio from crm_profile where scope = ${scope} order by person`;
    expect(rows.map(r => ({ ...r }))).toEqual([{ person: "person-one", revision: 2, public_bio: false }, { person: "person-two", revision: 1, public_bio: false }]);
    await expect(saveProfile(scope, "person-two", { ...body, revision: 7 })).rejects.toMatchObject({ status: 409 });
  });
  it("keeps concurrent reports as rows, deduplicates repeats and persists blocking", async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) => reportTarget(scope, `reporter-${i}`, { kind: "item", ref: `item-${i}` }, "Needs review")));
    await Promise.all(Array.from({ length: 5 }, () => reportTarget(scope, "same-person", { kind: "person", ref: "reported" }, "Check this")));
    expect((await db`select count(*)::int as n from crm_report where scope = ${scope}`)[0].n).toBe(21);
    await moderate(scope, "blocker", { action: "block", ref: "other" });
    await moderate(scope, "blocker", { action: "block", ref: "other" });
    expect(await isBlocked("blocker", "other", scope)).toBe(true);
    expect(await isBlocked("other", "blocker", scope)).toBe(false);
    expect((await db`select count(*)::int as n from crm_block where scope = ${scope}`)[0].n).toBe(1);
  });
  it("permits only one concurrent review and records its actor and time atomically", async () => {
    const report = (await moderationQueue(scope)).reports.find(r => r.kind === "item")!;
    const outcomes = await Promise.allSettled([
      moderate(scope, "owner", { action: "hide", id: report.id }),
      moderate(scope, "admin", { action: "dismiss", id: report.id }),
    ]);
    expect(outcomes.filter(o => o.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(o => o.status === "rejected").map(o => (o as PromiseRejectedResult).reason.status)).toEqual([409]);
    const audit = await moderationAudit(scope);
    expect(audit).toHaveLength(1);
    const [row] = await db`select decided_by, decided_at, ref from crm_report where id = ${report.id}`;
    expect({ by: row.decided_by, at: row.decided_at.toISOString() }).toEqual({ by: audit[0].by, at: audit[0].at });
    expect(await isHidden(row.ref, scope)).toBe(audit[0].action === "hide");
  });
  it("refuses unknown, malformed and person-hide decisions with plain errors", async () => {
    await expect(moderate(scope, "owner", { action: "hide", id: "missing" })).rejects.toMatchObject({ status: 404 });
    await expect(moderate(scope, "owner", { action: "hide", id: randomUUID() })).rejects.toMatchObject({ status: 404 });
    const person = (await moderationQueue(scope)).reports.find(r => r.kind === "person")!;
    await expect(moderate(scope, "owner", { action: "hide", id: person.id })).rejects.toThrow("Only items can be hidden");
    expect((await moderationQueue(scope)).reports.find(r => r.id === person.id)!.status).toBe("open");
  });
  it("has no workspace document ceiling and serves a bounded queue, open reports first", async () => {
    await db`insert into crm_report (id, scope, kind, ref, reason, reported_by, reported_at, status, decided_by, decided_at)
      select gen_random_uuid(), ${scope}, 'item', 'bulk-' || n, 'Old', 'r-' || n, now() - interval '1 day', 'dismissed', 'owner', now() - interval '1 day'
      from generate_series(1, 3500) n`;
    await reportTarget(scope, "late", { kind: "item", ref: "after-cap" }, "Still accepted");
    const { reports } = await moderationQueue(scope);
    expect(reports).toHaveLength(200);
    expect(reports.slice(0, 21).every(r => r.status === "open")).toBe(true);
    expect(reports.some(r => r.reason === "Still accepted")).toBe(true);
  });
});
