import { chromium, expect, test } from "@playwright/test";
import { BASE } from "./base";

// Headless only: never a visible browser window.
test("consent: check, add, let someone be messaged again, and unsubscribe from the public page", async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ baseURL: BASE });
  await context.addCookies([{ name: "pramaan_member", value: "mbr_owner", url: BASE }]);
  const page = await context.newPage();
  await page.request.post("/api/demo", { data: { action: "reset" } });

  await page.goto("/consent");
  await expect(page.getByRole("list", { name: "Opt-outs" }).getByRole("listitem")).toHaveCount(3);
  await expect(page.getByText("Sample contact")).toContainText("Opted out of text messages");
  await expect(page.locator("body")).not.toContainText("+14155550100");

  const check = page.getByRole("form", { name: "Check a contact" });
  await check.getByLabel("Phone number or email").fill("+14155550100");
  await check.getByRole("button", { name: "Check" }).click();
  await expect(check).toContainText("would be refused");

  const add = page.getByRole("form", { name: "Add an opt-out" });
  await add.getByLabel(/Phone number or email/).fill("+14155550177");
  await add.getByLabel(/Why/).fill("Asked by letter");
  await add.getByRole("button", { name: "Add opt-out" }).click();
  await expect(page.getByRole("list", { name: "Opt-outs" }).getByRole("listitem")).toHaveCount(4);

  await page.getByRole("button", { name: /Remove \+14…77/ }).click();
  await page.getByRole("button", { name: "Let them be messaged again" }).click();
  await expect(page.getByText(/Removal is waiting for approval/)).toBeVisible();
  await expect(page.getByRole("list", { name: "Opt-outs" }).getByRole("listitem")).toHaveCount(4);

  // The public page: no sign-in.
  const visitor = await (await browser.newContext({ baseURL: BASE })).newPage();
  await visitor.goto(`/stop?link=${encodeURIComponent("http://pramaan.fake/unsubscribe/recipient_demo")}`);
  await visitor.getByRole("button", { name: "Unsubscribe" }).click();
  await expect(visitor.getByRole("status")).toContainText("You are unsubscribed from emails from this app.");
  await page.reload();
  await expect(page.getByRole("list", { name: "Opt-outs" }).getByRole("listitem")).toHaveCount(5);

  await browser.close();
});
