import { chromium, expect, test } from "@playwright/test";
import { BASE } from "./base";

// Headless only: never a visible browser window.
test("payouts: see what is needed, finish the stand-in setup, and end ready", async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ baseURL: BASE });
  await context.addCookies([{ name: "pramaan_member", value: "mbr_owner", url: BASE }]);
  const page = await context.newPage();
  await page.request.post("/api/demo", { data: { action: "reset" } });

  await page.goto("/payouts");
  await expect(page.getByText("Setting up", { exact: true })).toBeVisible();
  await expect(page.getByText("Your business website")).toBeVisible();
  await page.getByRole("button", { name: "Set up payments" }).click();
  await expect(page.getByText("Demo stand-in")).toBeVisible();
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page.getByText("Ready", { exact: true })).toBeVisible();
  await expect(page.getByText("You can take payments and receive payouts.")).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/fake_secret|pk_test|external_account/);
  await browser.close();
});
