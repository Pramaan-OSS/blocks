import { chromium, expect, test } from "@playwright/test";
import { BASE } from "./base";

// Headless only: never a visible browser window.
test("an exam goes draft, published, invited, graded; an unused invitation is withdrawn after approval", async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ baseURL: BASE });
  await context.addCookies([{ name: "pramaan_member", value: "mbr_owner", url: BASE }]);
  const page = await context.newPage();
  await page.request.post("/api/demo", { data: { action: "reset" } });

  await page.goto("/assessment");
  await page.getByRole("button", { name: "New exam" }).click();
  await page.getByLabel(/Title/).fill("Support screen");
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page.getByRole("heading", { level: 2, name: /Support screen/ })).toBeVisible();

  await page.getByLabel("Question *").fill("Do you apologise first?");
  await page.getByLabel("Option 1", { exact: true }).fill("Yes");
  await page.getByLabel("Option 2", { exact: true }).fill("No");
  await page.getByLabel("Option 1 is correct").check();
  await page.getByRole("button", { name: "Add question" }).click();
  await expect(page.getByRole("list", { name: "Questions" })).toContainText("Do you apologise first?");

  await page.getByRole("button", { name: "Publish exam" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("cannot be undone");
  await page.getByRole("alertdialog").getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByText("Published. The questions are now frozen.")).toBeVisible();

  await page.getByRole("tab", { name: "Candidates" }).click();
  await page.getByLabel(/Candidate emails/).fill("sam@example.com\nlee@example.com");
  await page.getByLabel("How to deliver").selectOption("link");
  await page.getByRole("button", { name: "Create links" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("sam@example.com, lee@example.com");
  await page.getByRole("alertdialog").getByRole("button", { name: "Create links" }).click();
  const link = await page.getByLabel("Link for sam@example.com").inputValue();
  const samRef = link.split("/").pop()!;
  await expect(page.getByLabel("Counts")).toContainText("Link created 2");

  // Sam finishes the test on the hosted page; grading ends.
  await page.request.post("/api/demo", { data: { action: "finish", ref: samRef } });
  await page.getByRole("button", { name: "Details for sam@example.com" }).click();
  await expect(page.getByLabel("Result")).toContainText("82", { timeout: 10_000 });
  await expect(page.getByLabel("Result")).toContainText("Passed");
  await expect(page.getByLabel("Integrity")).toContainText("Clean");

  // Lee never starts: withdraw the invitation. It waits in the approvals inbox.
  const lee = page.getByRole("row").filter({ hasText: "lee@example.com" });
  await lee.getByRole("button", { name: "Withdraw" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Withdraw" }).click();
  await expect(page.getByText(/Withdrawal sent for approval/)).toBeVisible();
  const inbox = await (await page.request.get("/api/pramaan/approvals")).json();
  const wait = inbox.results.find((a: { capability: string }) => a.capability === "assessment.invitation.revoke");
  expect((await page.request.post(`/api/pramaan/approvals/${wait.approval_id}/decide`, { data: { decision: "approve" } })).status()).toBe(200);
  await page.reload();
  await page.getByRole("button", { name: /Support screen/ }).click();
  await page.getByRole("tab", { name: "Candidates" }).click();
  await expect(page.getByLabel("Counts")).toContainText("Revoked 1");

  await browser.close();
});
