import { chromium, expect, test } from "@playwright/test";
import { BASE } from "./base";

// Headless only: never a visible browser window.
test("picker: find an action in plain words, answer the question, run a read-only one, send one through the inbox", async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ baseURL: BASE });
  await context.addCookies([{ name: "pramaan_member", value: "mbr_owner", url: BASE }]);
  const page = await context.newPage();
  await page.request.post("/api/demo", { data: { action: "reset" } });

  await page.goto("/picker");
  await page.getByLabel("What do you want to do?").fill("web");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("list", { name: "Matches" }).getByRole("listitem")).toHaveCount(2);
  await page.getByRole("button", { name: /Search the web/ }).click();
  await page.getByLabel(/Search for/).fill("pramaan");
  await page.getByRole("button", { name: "Get the price" }).click();
  await page.getByRole("button", { name: "Run it", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Run it", exact: true }).click();
  await expect(page.getByLabel("What came back")).toContainText("Results for pramaan");

  // Ambiguous words: one question, then a send that waits for a yes.
  await page.getByLabel("What do you want to do?").fill("send");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("region", { name: "A quick question" }).getByRole("button", { name: "Send a text message" }).click();
  await page.getByLabel(/^To/).fill("+15555550123");
  await page.getByLabel(/Message/).fill("Your table is ready.");
  await page.getByRole("button", { name: "Get the price" }).click();
  await page.getByRole("button", { name: "Ask for a yes", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Ask for a yes", exact: true }).click();
  await expect(page.getByText(/Waiting for a yes/)).toBeVisible();
  await page.getByRole("link", { name: "Open the approvals inbox" }).click();
  await expect(page.getByRole("list", { name: "Requests waiting for approval" })).toContainText("Send a text message");

  await browser.close();
});
