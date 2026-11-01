import { chromium, expect, test } from "@playwright/test";
import { BASE } from "./base";

// Headless only: never a visible browser window.
test("identity check: start, pass the stand-in screen in the page, and read Verified", async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ baseURL: BASE })).newPage();
  await page.request.post("/api/demo", { data: { action: "reset" } });

  await page.goto("/identity");
  await page.getByRole("button", { name: "Check my identity" }).click();
  const frame = page.frameLocator("iframe[title='Identity check']");
  await expect(frame.getByText("Demo stand-in")).toBeVisible();
  await frame.getByRole("button", { name: "Pass the check" }).click();
  await expect(page.getByText("Verified", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Face match")).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/ref_FAKE|Lovelace|face_match/);
  await browser.close();
});
