import { chromium, expect, test } from "@playwright/test";
import { BASE } from "./base";

// Headless only: never a visible browser window.
test("voice: dial on the keypad, wait for a yes, connect, hang up, call back from recent calls", async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ baseURL: BASE });
  const page = await context.newPage();
  await page.request.post("/api/demo", { data: { action: "reset" } });

  await page.goto("/voice");
  await expect(page.getByText("Demo stand-in")).toBeVisible();
  for (const k of "4155550100") await page.getByRole("button", { name: k, exact: true }).click();
  await expect(page.getByLabel("Phone number")).toHaveValue("415 555 0100");
  await page.getByRole("button", { name: "Delete last digit" }).click();
  await page.getByRole("button", { name: "0", exact: true }).click();
  await page.getByLabel("Phone number").fill("+1 415 555 0100");
  await expect(page.getByLabel("Phone number")).toHaveValue("+1 415 555 0100");
  await page.getByRole("button", { name: "Call", exact: true }).click();
  await expect(page.getByText("Waiting for a yes before the call starts.")).toBeVisible();

  // A member says yes in the approvals inbox, in another tab.
  const inbox = await context.newPage();
  await inbox.goto("/");
  await inbox.getByRole("button", { name: "Sign in as approver" }).click();
  const first = inbox.getByRole("list", { name: "Requests waiting for approval" }).getByRole("button").first();
  await first.click();
  await expect(inbox.getByLabel("What it will use")).toContainText("+14155550100");
  await inbox.getByRole("button", { name: "Approve", exact: true }).click();
  await inbox.getByRole("alertdialog").getByRole("button", { name: "Approve", exact: true }).click();
  await expect(inbox.getByRole("status").filter({ hasText: "Approved. The call runs once." })).toBeVisible();

  await expect(page.getByText("+1 415 555 0100").first()).toBeVisible();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel("Time on the call")).toHaveText(/^\d+:\d\d$/);
  await expect(page.getByRole("button", { name: /keypad|hold/i })).toHaveCount(0);
  await page.getByRole("button", { name: "Mute" }).click();
  await expect(page.getByRole("button", { name: "Unmute" })).toBeVisible();
  await page.getByRole("button", { name: "Hang up" }).click();
  await expect(page.getByText("Call ended")).toBeVisible();
  await expect(page.getByRole("button", { name: "Hang up" })).toHaveCount(0);
  const recent = page.getByRole("list", { name: "Recent calls" });
  await expect(recent).toContainText("+1 415 555 0100");
  await expect(recent).toContainText("Answered");
  await expect(page.locator("body")).not.toContainText(/ref_FAKE|cred_|ve_\d/);

  // One click calls back, and waits for a yes again.
  await page.getByRole("button", { name: "Call back +1 415 555 0100" }).click();
  await expect(page.getByText("Waiting for a yes before the call starts.")).toBeVisible();
  await browser.close();
});
