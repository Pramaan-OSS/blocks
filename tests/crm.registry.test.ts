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
