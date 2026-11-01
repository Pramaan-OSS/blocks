import { chromium, expect, test } from "@playwright/test";
import { BASE } from "./base";

// Headless only: never a visible browser window.
test("booking: needs connection, connect the calendar, book a time, a member says yes", async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ baseURL: BASE });
  const page = await context.newPage();
  await page.request.post("/api/demo", { data: { action: "reset" } });

  await page.goto("/booking");
  await expect(page.getByText("The calendar needs to be connected again.")).toBeVisible();
  await page.getByRole("link", { name: "Go to connections" }).click();
  await expect(page).toHaveURL(/\/connections/);
  await page.getByRole("listitem", { name: "Google Calendar" }).getByRole("button", { name: "Reconnect" }).click();
  await expect(page.getByText("Google Calendar is connected.")).toBeVisible();

  await page.goto("/booking");
  const first = page.getByRole("group", { name: "Time" }).getByRole("button").first();
  const time = (await first.textContent())!;
  await first.click();
  await page.getByLabel("Your name").fill("Sam Lee");
  await page.getByLabel("Your email").fill("sam@example.com");
  await page.getByRole("button", { name: "Book this time" }).click();
  await expect(page.getByText("Request sent")).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/ref_FAKE|googlecalendar/);

  // A member says yes in the approvals inbox, in another tab.
  const inbox = await context.newPage();
  await inbox.goto("/");
  await inbox.getByRole("button", { name: "Sign in as approver" }).click();
  await inbox.getByRole("list", { name: "Requests waiting for approval" }).getByRole("button").first().click();
  await inbox.getByRole("button", { name: "Approve", exact: true }).click();
  await inbox.getByRole("alertdialog").getByRole("button", { name: "Approve", exact: true }).click();
  await expect(inbox.getByRole("status").filter({ hasText: /Approved/ })).toBeVisible();

  await page.goto("/booking");
  await expect(page.getByRole("group", { name: "Time" }).getByRole("button").first()).not.toHaveText(time);
  await browser.close();
});
