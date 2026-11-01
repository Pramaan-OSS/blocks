import { chromium, expect, test } from "@playwright/test";
import { BASE } from "./base";

// Headless only: never a visible browser window.
test("the wallet shows balance and usage, a run changes them, and a low-credit refusal leads to top-up", async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ baseURL: BASE });
  await page.request.post("/api/demo", { data: { action: "reset" } });

  await page.goto("/wallet");
  await expect(page.getByLabel("Balance $12.34")).toBeVisible();
  await expect(page.getByRole("link", { name: /Add credit/ })).toHaveAttribute("href", /settings\/wallet/);
  await expect(page.getByRole("list", { name: "Spend by day" }).locator("li")).toHaveCount(7);
  await page.getByRole("button", { name: "Last 30 days" }).click();
  await expect(page.getByRole("list", { name: "Spend by day" }).locator("li")).toHaveCount(30);
  await expect(page.getByRole("table", { name: "Spend by action" })).toContainText("Find company news");

  // A run spends $0.21.
  await page.goto("/missions");
  await page.getByLabel("Mission").selectOption("company.research");
  await page.getByLabel(/Domain/).fill("example.com");
  await page.getByRole("button", { name: "Get estimate" }).click();
  await page.getByRole("button", { name: "Start" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Start" }).click();
  await expect(page.getByLabel("Result")).toBeVisible({ timeout: 15_000 });
  await page.goto("/wallet");
  await expect(page.getByLabel("Balance $12.13")).toBeVisible();
  await expect(page.getByRole("table", { name: "Latest activity" })).toContainText("Write with AI");

  // Too little credit: the estimate refuses, and its link leads to the top-up.
  await page.request.post("/api/demo", { data: { action: "balance", micro: 50_000 } });
  await page.goto("/wallet");
  await expect(page.getByLabel("Balance", { exact: true }).getByRole("alert")).toContainText("Your balance is low ($0.05)");
  await page.goto("/missions");
  await page.getByRole("button", { name: "Start another run" }).click();
  await page.getByLabel("Mission").selectOption("company.research");
  await page.getByLabel(/Domain/).fill("example.org");
  await page.getByRole("button", { name: "Get estimate" }).click();
  await page.getByLabel("Estimate").getByRole("link", { name: "Add credit" }).click();
  await expect(page).toHaveURL(/\/wallet\?topup=1/);
  await expect(page.getByText(/needs more credit than you have/)).toBeVisible();
  await expect(page.getByRole("link", { name: /Add credit/ })).toBeFocused();

  await browser.close();
});
