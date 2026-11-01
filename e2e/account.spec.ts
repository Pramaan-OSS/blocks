import { chromium, expect, test } from "@playwright/test";
import { BASE } from "./base";

// Headless only: never a visible browser window.
test("account: an owner sees the team and renames the organisation; a viewer can only look", async () => {
  const browser = await chromium.launch({ headless: true });
  const owner = await browser.newContext({ baseURL: BASE });
  await owner.addCookies([{ name: "pramaan_member", value: "mbr_owner", url: BASE }]);
  const page = await owner.newPage();
  await page.request.post("/api/demo", { data: { action: "reset" } });

  await page.goto("/account");
  await expect(page.getByRole("region", { name: "You" })).toContainText("Owner");
  await expect(page.getByRole("list", { name: "Team members" }).getByRole("listitem")).toHaveCount(2);
  await expect(page.locator("body")).not.toContainText(/mbr_|_micro/);
  await page.getByLabel("Organisation name").fill("Acme Ltd");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Organisation name")).toHaveValue("Acme Ltd");

  const viewer = await browser.newContext({ baseURL: BASE });
  await viewer.addCookies([{ name: "pramaan_member", value: "mbr_viewer", url: BASE }]);
  const v = await viewer.newPage();
  await v.goto("/account");
  await expect(v.getByText("Only owners and admins see the team")).toBeVisible();
  await expect(v.getByRole("region", { name: "Organisation" })).toContainText("Acme Ltd");
  await expect(v.getByLabel("Organisation name")).toHaveCount(0);
  await browser.close();
});
