import { chromium, expect, test } from "@playwright/test";
import { BASE } from "./base";

// Headless only: never a visible browser window.
test("chat: a streamed reply, an email that waits in the inbox, and the chat carrying on after the yes", async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ baseURL: BASE });
  await context.addCookies([{ name: "pramaan_member", value: "mbr_owner", url: BASE }]);
  const page = await context.newPage();
  await page.request.post("/api/demo", { data: { action: "reset" } });

  await page.goto("/chat");
  await expect(page.getByText("Ask anything")).toBeVisible();
  await page.getByLabel("Your message").fill("hello there");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("You said: hello there")).toBeVisible();
  await expect(page.getByText("This reply cost under $0.01")).toBeVisible();

  await page.getByLabel("Your message").fill("Email lee@example.com please");
  await page.keyboard.press("Enter");
  const card = page.locator(".pr-card", { hasText: "Send an email" });
  await expect(card).toContainText("Waiting for a yes");
  await expect(card).toContainText("lee@example.com");
  await expect(card.getByRole("link", { name: "approvals inbox" })).toHaveAttribute("href", "/");
  await expect(page.locator("body")).not.toContainText(/apr_|tc_FAKE|email\.send/);

  // A team member says yes in the inbox (here through its route); the chat goes on by itself.
  const list = (await (await context.request.get("/api/pramaan/approvals")).json()) as { results: { approval_id: string; input: { to?: string } }[] };
  const mine = list.results.find((a) => a.input.to === "lee@example.com")!;
  const decided = await context.request.post(`/api/pramaan/approvals/${mine.approval_id}/decide`, { data: { decision: "approve" }, headers: { "Idempotency-Key": "e2e-chat" } });
  expect(decided.ok()).toBe(true);
  await expect(page.getByText("Done. The email is on its way.")).toBeVisible({ timeout: 15_000 });
  await expect(card).toContainText("Done");
  await browser.close();
});
