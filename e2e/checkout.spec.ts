import { chromium, expect, test } from "@playwright/test";
import { BASE } from "./base";

// Headless only: never a visible browser window.
test("checkout: pay on the stand-in page and come back to a paid card; cancelling shows no payment", async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ baseURL: BASE })).newPage();
  await page.request.post("/api/demo", { data: { action: "reset" } });

  await page.goto("/checkout");
  await expect(page.getByRole("list", { name: "Plans" }).getByRole("listitem")).toHaveCount(2);
  await expect(page.getByText("$20.00")).toBeVisible();
  await page.getByRole("button", { name: "Pay for Starter" }).click();
  await expect(page.getByText("Demo stand-in")).toBeVisible();
  await page.getByRole("button", { name: "Pay", exact: true }).click();
  await expect(page).toHaveURL(/\/checkout\/done/);
  await expect(page.getByRole("region", { name: "Payment" })).toContainText("Paid");
  await expect(page.locator("body")).not.toContainText(/ref_FAKE/);

  await page.goto("/checkout");
  await page.getByRole("button", { name: "Pay for Team" }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page).toHaveURL(/\/checkout$/);
  await browser.close();
});
