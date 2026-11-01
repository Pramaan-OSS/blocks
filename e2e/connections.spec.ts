import { chromium, expect, test } from "@playwright/test";
import { BASE } from "./base";

// Headless only: never a visible browser window.
test("connect leads through sign-in and back, reconnect works, and disconnect shows revoked", async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ baseURL: BASE });
  await page.request.post("/api/demo", { data: { action: "reset" } });

  await page.goto("/connections");
  const outlook = page.getByRole("listitem", { name: "Outlook" });
  await expect(outlook).toContainText("Not connected");
  await expect(page.getByRole("listitem", { name: "Google Calendar" })).toContainText("Needs reconnect");
  await expect(page.getByRole("listitem", { name: "GitHub" })).toContainText("Revoked");

  // Connect: out to the sign-in, back to the return page, which re-checks the status.
  await outlook.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page).toHaveURL(/\/connections\/return\?app=outlook/);
  await expect(page.getByText("Outlook is connected.")).toBeVisible();
  await page.getByRole("link", { name: "Back to your connections" }).click();
  await expect(page.getByRole("listitem", { name: "Outlook" })).toContainText("Connected");

  // Reconnect the expired calendar.
  await page.getByRole("listitem", { name: "Google Calendar" }).getByRole("button", { name: "Reconnect" }).click();
  await expect(page.getByText("Google Calendar is connected.")).toBeVisible();
  await page.goto("/connections");
  await expect(page.getByRole("listitem", { name: "Google Calendar" })).toContainText("Connected");

  // Disconnect Outlook.
  await page.getByRole("listitem", { name: "Outlook" }).getByRole("button", { name: "Disconnect" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByText("Outlook is disconnected and its access is revoked.")).toBeVisible();
  await expect(page.getByRole("listitem", { name: "Outlook" })).toContainText("Revoked");

  await browser.close();
});
