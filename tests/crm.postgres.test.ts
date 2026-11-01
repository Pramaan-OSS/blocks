import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { changeData, closeCrmDatabase, CrmProblem, readData } from "@/lib/pramaan/crm-data";
import { getContacts, updateContacts } from "@/lib/pramaan/contacts";
import { getPipeline, updatePipeline } from "@/lib/pramaan/pipeline";

// Use a disposable database. Only these generated scopes are removed on cleanup.
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("review 4: Postgres storage", () => {
  const scope = `crm-test-${randomUUID()}`;
  const rejectedScope = `${scope}-rejected`;
  let db: ReturnType<typeof postgres>;
  beforeAll(async () => {
    vi.stubEnv("PRAMAAN_FAKE", "0");
    vi.stubEnv("DATABASE_URL", url!);
    db = postgres(url!, { max: 5, prepare: false });
    for (const block of ["contacts", "pipeline"]) {
      const migration = await readFile(`registry/${block}/src/db/migrations/crm_${block}_001.sql`, "utf8");
      await db.unsafe(migration);
      await db.unsafe(migration); // Reapplying is safe.
    }
  });
  afterAll(async () => {
    try {
      if (db) for (const block of ["contacts", "pipeline"]) await db.unsafe(`delete from crm_${block} where scope in ($1, $2)`, [scope, rejectedScope]);
    } finally {
      await closeCrmDatabase();
      await db?.end();
      vi.unstubAllEnvs();
    }
  });
  it("keeps every concurrent addition under row locking", async () => {
    await updateContacts(scope, { action: "save", kind: "person", name: "First" });
    await Promise.all(Array.from({ length: 20 }, (_, i) => updateContacts(scope, { action: "save", kind: "person", name: `Contact ${i}` })));
    const names = (await getContacts(scope)).contacts.map(c => c.name).sort();
    expect(names).toEqual(["First", ...Array.from({ length: 20 }, (_, i) => `Contact ${i}`)].sort());
  });
  it("rolls back a rejected change, including its first insert", async () => {
    const before = await getContacts(scope);
    await expect(changeData("contacts", scope, { contacts: [] }, state => { state.contacts = []; throw new CrmProblem("Rejected"); })).rejects.toThrow("Rejected");
    expect(await getContacts(scope)).toEqual(before);
    await expect(changeData("contacts", rejectedScope, { contacts: [] }, () => { throw new CrmProblem("Rejected"); })).rejects.toThrow("Rejected");
    expect(await db.unsafe("select scope from crm_contacts where scope = $1", [rejectedScope])).toHaveLength(0);
  });
  it("round-trips jsonb and rejects a stale card edit after a move", async () => {
    const date = new Date("2026-11-01T12:00:00Z");
    const result = await changeData("pipeline", rejectedScope, { value: {} as unknown }, state => { state.value = { date, absent: undefined }; });
    expect(result).toEqual({ value: { date: date.toISOString() } });
    expect(await readData("pipeline", rejectedScope, {})).toEqual(result);
    const card = (await updatePipeline(scope, { action: "save", kind: "deal", title: "Contract", owner: "Alex", stage: "New", value: 1.25 })).deals[0];
    await updatePipeline(scope, { action: "move", id: card.id, revision: 0, stage: "Won" });
    await expect(updatePipeline(scope, { action: "save", id: card.id, revision: 0, kind: "deal", title: "Stale", owner: "Alex", value: 1.25 })).rejects.toMatchObject({ status: 409 });
    expect((await getPipeline(scope)).deals[0]).toMatchObject({ title: "Contract", stage: "Won", revision: 1 });
  });
});
