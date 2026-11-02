import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import registry from "../registry.json";
it("review 9: independently installed CRM migrations have distinct numbered names", () => {
  for (const block of ["contacts", "pipeline"]) {
    const item = registry.items.find(item => item.name === block)!;
    const migrations = item.files.filter(file => file.target.includes("/migrations/"));
    expect(migrations.map(file => file.target)).toEqual([`src/db/migrations/crm_${block}_001.sql`]);
    expect(readFileSync(migrations[0].path, "utf8")).toContain(`CREATE TABLE IF NOT EXISTS crm_${block}`);
  }
});
it("profiles and moderation install only their row tables, in one numbered migration each", () => {
  const targets = (name: string) => registry.items.find(item => item.name === name)!.files.map(file => file.target).filter(target => target.includes("/migrations/")).sort();
  expect(targets("moderation")).toEqual(["src/db/migrations/crm_moderation_001.sql"]);
  expect(targets("profiles")).toEqual(["src/db/migrations/crm_moderation_001.sql", "src/db/migrations/crm_profiles_001.sql"]);
  const profiles = readFileSync("registry/profiles/src/db/migrations/crm_profiles_001.sql", "utf8");
  const moderation = readFileSync("registry/moderation/src/db/migrations/crm_moderation_001.sql", "utf8");
  expect(profiles).toContain("CREATE TABLE IF NOT EXISTS crm_profile (");
  for (const table of ["crm_report", "crm_block", "crm_hidden_item", "crm_moderation_audit"]) expect(moderation).toContain(`CREATE TABLE IF NOT EXISTS ${table} (`);
  // The unused document tables are never created.
  expect(profiles + moderation).not.toMatch(/crm_profiles \(|crm_moderation \(/);
});
