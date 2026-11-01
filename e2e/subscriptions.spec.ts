import { chromium, expect, test } from "@playwright/test";
import { BASE } from "./base";

// Headless only: never a visible browser window.
test("subscriptions: see the plan, cancel on the billing page, come back to a plan that is ending", async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ baseURL: BASE })).newPage();
  await page.request.post("/api/demo", { data: { action: "reset" } });

  await page.goto("/subscriptions");
  await expect(page.getByText("$29.00 a month")).toBeVisible();
  await expect(page.getByText(/^Renews on/)).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/sub_|cus_|past_due/);

  await page.getByRole("button", { name: "Manage billing" }).click();
  await expect(page.getByText("Demo stand-in")).toBeVisible();
  await page.getByRole("button", { name: "Cancel at the end of the period" }).click();
  await expect(page.getByText("Your plan will end when the paid period does.")).toBeVisible();
  await page.getByRole("button", { name: "Back to the app" }).click();
  await expect(page).toHaveURL(/\/subscriptions$/);
  await expect(page.getByText("Ending")).toBeVisible();
  await expect(page.getByText(/You won't be charged again/)).toBeVisible();
  await browser.close();
});
