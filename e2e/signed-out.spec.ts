import { expect, test } from "@playwright/test";
import { BASE } from "./base";

test("the demo starts signed in, offers a real signed-out choice, and never shows key or header wording", async ({ page, context }) => {
  for (const path of ["/consent", "/payouts"]) {
    await page.goto(path);
    await expect(page.locator("main h1")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Sign in to see this.");
  }

  await page.goto("/");
  await page.getByRole("button", { name: "Sign out" }).click();
  for (const path of ["/consent", "/payouts", "/chat"]) {
    await page.goto(path);
    if (path === "/chat") {
      await page.getByLabel("Your message").fill("hello");
      await page.keyboard.press("Enter");
    }
    await expect(page.getByText("Sign in to see this.").first()).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/api key|authorization|header|PRAMAAN_/i);
  }

  await context.clearCookies({ name: "pramaan_member" });
  await page.goto(`${BASE}/consent`);
  await expect(page.locator("body")).not.toContainText("Sign in to see this.");
});
