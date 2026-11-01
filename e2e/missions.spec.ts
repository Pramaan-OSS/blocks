import { chromium, expect, test } from "@playwright/test";
import { BASE } from "./base";

// Headless only: never a visible browser window.
test("a mission shows its steps, survives a reload, finishes with a cost, and cancels cleanly", async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ baseURL: BASE });
  await page.request.post("/api/demo", { data: { action: "reset" } });

  await page.goto("/missions");
  await page.getByLabel("Mission").selectOption("company.research");
  await page.getByLabel(/Domain/).fill("example.com");
  await page.getByRole("button", { name: "Get estimate" }).click();
  await expect(page.getByLabel("Estimate")).toContainText("at most $0.21");

  await page.getByRole("button", { name: "Start" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Start" }).click();
  const steps = page.getByRole("list", { name: "Steps" }).getByRole("listitem");
  await expect(steps).toHaveCount(4);
  await expect(steps.first()).toHaveAttribute("data-status", /running|done/);

  // Reload mid-run: the same run comes back.
  await expect(steps.first()).toHaveAttribute("data-status", "done");
  await page.reload();
  await expect(steps).toHaveCount(4);
  await expect(steps.first()).toHaveAttribute("data-status", "done");

  await expect(page.getByLabel("Result")).toContainText("A sourced profile of example.com.", { timeout: 15_000 });
  await expect(page.getByText("Cost:")).toContainText("$0.21");

  // A second run, cancelled after the first step.
  await page.getByRole("button", { name: "Start another run" }).click();
  await page.getByLabel("Mission").selectOption("company.research");
  await page.getByLabel(/Domain/).fill("example.org");
  await page.getByRole("button", { name: "Get estimate" }).click();
  await page.getByRole("button", { name: "Start" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Start" }).click();
  await expect(steps.first()).toHaveAttribute("data-status", "done", { timeout: 10_000 });
  await page.getByRole("button", { name: "Cancel run" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("You pay only for the work already done");
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel run" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Cancelled. You were charged" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel run" })).toHaveCount(0);

  await browser.close();
});
