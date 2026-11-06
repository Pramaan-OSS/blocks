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
it("profiles and moderation install only their row tables, in numbered migrations", () => {
  const targets = (name: string) => registry.items.find(item => item.name === name)!.files.map(file => file.target).filter(target => target.includes("/migrations/")).sort();
  expect(targets("moderation")).toEqual(["src/db/migrations/crm_moderation_001.sql", "src/db/migrations/crm_moderation_002.sql"]);
  expect(targets("profiles")).toEqual(["src/db/migrations/crm_moderation_001.sql", "src/db/migrations/crm_moderation_002.sql", "src/db/migrations/crm_profiles_001.sql"]);
  // Feed and messaging read names and blocks from these tables, so each ships their migrations too.
  for (const block of ["feed", "messaging"]) expect(targets(block)).toEqual([...new Set([...targets("profiles"), `src/db/migrations/crm_${block}_001.sql`])].sort());
  const profiles = readFileSync("registry/profiles/src/db/migrations/crm_profiles_001.sql", "utf8");
  const moderation = readFileSync("registry/moderation/src/db/migrations/crm_moderation_001.sql", "utf8");
  expect(profiles).toContain("CREATE TABLE IF NOT EXISTS crm_profile (");
  for (const table of ["crm_report", "crm_block", "crm_hidden_item", "crm_moderation_audit"]) expect(moderation).toContain(`CREATE TABLE IF NOT EXISTS ${table} (`);
  // The unused document tables are never created.
  expect(profiles + moderation).not.toMatch(/crm_profiles \(|crm_moderation \(/);
});
it("listings and applications install their row tables and everything they import", () => {
  const item = (name: string) => registry.items.find(item => item.name === name)!;
  const migrations = (name: string) => item(name).files.map(file => file.target).filter(target => target.includes("/migrations/")).sort();
  expect(migrations("listings")).toEqual(["src/db/migrations/crm_listings_001.sql", "src/db/migrations/crm_moderation_001.sql", "src/db/migrations/crm_moderation_002.sql"]);
  expect(migrations("applications")).toEqual(["src/db/migrations/crm_applications_001.sql", "src/db/migrations/crm_listings_001.sql", "src/db/migrations/crm_moderation_001.sql", "src/db/migrations/crm_moderation_002.sql"]);
  // Its screens link to the listing page, so that page comes with it.
  expect(item("applications").files.map(file => file.target)).toContain("app/listings/[listing]/page.tsx");
  for (const name of ["listings", "applications"]) {
    const targets = new Set(item(name).files.map(file => file.target));
    for (const file of item(name).files) {
      for (const [, path] of readFileSync(file.path, "utf8").matchAll(/from "@\/((?:lib|components)\/pramaan\/[^"]+)"/g)) {
        expect([...targets].some(target => target.startsWith(`${path}.`)), `${name}: ${file.path} imports ${path}`).toBe(true);
      }
    }
  }
});
