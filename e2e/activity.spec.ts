import { chromium, expect, test } from "@playwright/test";
import { BASE } from "./base";

// Headless only: never a visible browser window.
test("activity: filter to failures, read what went wrong and the next step, check webhook deliveries", async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ baseURL: BASE });
  await page.request.post("/api/demo", { data: { action: "reset" } });

  await page.goto("/activity");
  const calls = page.getByRole("list", { name: "Calls" });
  await expect(calls.getByRole("listitem")).toHaveCount(20);
  await expect(page.locator("body")).not.toContainText("call_fake");

  await page.getByLabel("How it went").selectOption({ label: "Failed" });
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(calls.getByRole("listitem").first()).toContainText("Failed");
  await calls.getByRole("listitem").first().getByRole("button").click();
  const detail = page.getByRole("region", { name: "Call details" });
  await expect(detail.getByRole("alert")).toBeVisible();
  await expect(detail).toContainText("What to do next:");
  await expect(detail.getByRole("button", { name: "Copy reference" })).toBeVisible();

  await page.getByRole("tab", { name: "Webhook deliveries" }).click();
  await expect(page.getByRole("list", { name: "Webhook deliveries" })).toContainText("Job finished");

  await page.getByRole("button", { name: "Replay", exact: true }).first().click();
  await expect(page.getByText("Replay queued.")).toBeVisible();

  await browser.close();
});
