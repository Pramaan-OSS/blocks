import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import registry from "../registry.json";

it("every block shipping the confirmation helper installs its dialog and button", () => {
  for (const item of registry.items) {
    if (!item.files.some(file => file.path.endsWith("/confirm-action.tsx"))) continue;
    expect(item.registryDependencies, item.name).toContain("alert-dialog");
    expect(item.registryDependencies, item.name).toContain("button");
  }
});

it("shipped routes use the default runtime for Cache Components compatibility", () => {
  const routes = new Set(registry.items.flatMap(item => item.files.filter(file => /\/route\.[jt]s$/.test(file.target)).map(file => file.path)));
  routes.add("app/api/pramaan/password-reset/route.ts");
  for (const path of routes) {
    expect(readFileSync(path, "utf8"), path).not.toMatch(/\bexport\s+(?:const|let|var)\s+runtime\b|\bexport\s*\{[^}]*\bruntime\b/);
  }
});
