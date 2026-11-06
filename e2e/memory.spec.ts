import { chromium, expect, test } from "@playwright/test";
import { BASE } from "./base";

// Headless only: never a visible browser window.
test("memory: search, delete one through the approvals inbox, see it in the changes, review an organisation memory", async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ baseURL: BASE });
  await context.addCookies([{ name: "pramaan_member", value: "mbr_owner", url: BASE }]);
  const page = await context.newPage();
  await page.request.post("/api/demo", { data: { action: "reset" } });

  await page.goto("/memory");
  await expect(page.getByRole("region", { name: "What it knows about me" })).toContainText("Prefers short, clear answers.");
  const list = page.getByRole("list", { name: "Memories" });
  await expect(list.getByRole("listitem")).toHaveCount(5);
  await expect(page.locator("body")).not.toContainText("Another person's");
  await page.getByLabel("Search what is remembered").fill("trip");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(list.getByRole("listitem")).toHaveCount(1);

  // Delete it: it waits for a yes in the inbox.
  await list.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText(/Deleting this memory was sent for approval/)).toBeVisible();
  await page.getByRole("link", { name: "Open the approvals inbox" }).click();
  await expect(page).toHaveURL(`${BASE}/`);
  const row = page.getByRole("button", { name: /Delete a memory/ });
  await row.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("What it will use")).toBeVisible();
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText("Approved. The call runs once.")).toBeVisible();

  await page.goto("/memory");
  await expect(page.getByRole("list", { name: "Memories" }).getByRole("listitem")).toHaveCount(4);
  await page.getByRole("tab", { name: "Recent changes" }).click();
  await expect(page.getByRole("list", { name: "Recent changes" }).getByText("Forgotten")).toBeVisible();

  // Organisation: an admin approves a suggested team fact.
  await page.getByRole("tab", { name: "Organisation" }).click();
  const review = page.getByRole("region", { name: "Waiting for review" });
  await review.getByRole("button", { name: "Approve", exact: true }).first().click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText("Approved. The team will remember it.")).toBeVisible();

  await browser.close();
});
