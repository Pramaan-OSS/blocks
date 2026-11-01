import { chromium, expect, test } from "@playwright/test";
import { BASE } from "./base";

// Headless only: never a visible browser window.
test("a demo send waits in the inbox, is approved once, and lands in history", async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ baseURL: BASE });
  await page.request.post("/api/demo", { data: { action: "reset" } });

  await page.goto("/");
  // Signed in as a viewer: read-only. (With no cookie the demo signs in the owner.)
  await page.getByRole("button", { name: "Sign in as viewer" }).click();
  await expect(page.getByText("You can see these requests, but only an approver can decide them.")).toBeVisible();

  await page.getByRole("button", { name: "Sign in as approver" }).click();
  await expect(page.getByRole("tab", { name: "Pending (2)" })).toBeVisible();
  await page.getByRole("button", { name: "Create a demo send" }).click();
  await expect(page.getByRole("tab", { name: "Pending (3)" })).toBeVisible();
  await expect(page.getByLabel("3 requests waiting for approval")).toBeVisible();

  // The newest request is first; open it with the keyboard.
  const first = page.getByRole("list", { name: "Requests waiting for approval" }).getByRole("button").first();
  await first.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("What it will use")).toContainText("sam@example.com");
  await expect(page.getByText("Maximum price")).toBeVisible();

  await page.getByRole("button", { name: "Approve", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("It runs once, exactly as shown");
  await dialog.getByRole("button", { name: "Approve", exact: true }).click();

  await expect(page.getByRole("status").filter({ hasText: "Approved. The call runs once." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Pending (2)" })).toBeVisible();

  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.getByRole("list", { name: "Your decisions" })).toContainText("Approved");

  // The same request cannot be decided again.
  const id = (await page.getByRole("list", { name: "Your decisions" }).locator("[data-approval-id]").first().getAttribute("data-approval-id"))!;
  const again = await page.request.post(`/api/pramaan/approvals/${id}/decide`, {
    data: { decision: "approve" },
    headers: { cookie: "pramaan_member=mbr_owner" },
  });
  expect(again.status()).toBe(409);

  await browser.close();
});
