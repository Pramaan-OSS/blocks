import { test, expect, type Page } from "@playwright/test";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhH0AAAAASUVORK5CYII=", "base64");
const INTERNAL = /mbr_|file_FAKE|[0-9a-f]{8}-[0-9a-f]{4}-|text\.classify|crm_/;
const as = (member: string) => ({ cookie: `pramaan_member=${member}` });
/** A person of their own for each walk, so the walks don't see each other's posts. */
async function signIn(page: Page, member: string) {
  await page.context().addCookies([{ name: "pramaan_member", value: member, domain: "localhost", path: "/" }]);
}
async function member(page: Page, ref: string, name: string) {
  const response = await page.request.post("/api/pramaan/profiles", { data: { revision: 0, name, bio: "", links: [], public: { name: true, bio: false, links: false, photo: false } }, headers: as(ref) });
  expect(response.ok()).toBeTruthy();
}
const feed = (page: Page, ref: string, data: unknown) => page.request.post("/api/pramaan/feed", { data: data as object, headers: as(ref) });
const message = (page: Page, ref: string, data: unknown) => page.request.post("/api/pramaan/messages", { data: data as object, headers: as(ref) });
async function shots(page: Page, name: string) {
  for (const mode of ["light", "dark"]) {
    await page.setViewportSize({ width: 1142, height: 732 });
    await page.evaluate(mode => document.documentElement.classList.toggle("dark", mode === "dark"), mode);
    await page.screenshot({ path: `.scratch/b3/${name}-${mode}.png` });
  }
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
}
test.beforeEach(async ({ page }) => { await page.request.post("/api/demo", { data: { action: "reset" } }); });

test("feed: follow from a profile page, post with a photo, like, comment, edit, delete, page", async ({ page }) => {
  await signIn(page, "e2e_reader");
  await member(page, "e2e_friend", "Priya Shah");
  for (let i = 1; i <= 21; i++) expect((await feed(page, "e2e_friend", { action: "post", text: `Update ${i}` })).ok()).toBeTruthy();
  await page.goto("/feed");
  await expect(page.getByText("Nothing here yet")).toBeVisible();
  await page.goto("/profiles/e2e_friend");
  await expect(page.getByRole("article", { name: "Public profile" })).toContainText("Priya Shah");
  await page.getByRole("button", { name: "Follow", exact: true }).click();
  await expect(page.getByRole("button", { name: "Unfollow" })).toBeVisible();
  await page.goto("/feed");
  const posts = page.getByRole("article", { name: "Post by Priya Shah" });
  await expect(posts).toHaveCount(20);
  await expect(posts.first()).toContainText("Update 21");
  await page.getByRole("button", { name: "Show more" }).click();
  await expect(posts).toHaveCount(21);
  await expect(page.getByRole("button", { name: "Show more" })).toHaveCount(0);
  await page.getByLabel("Share something").fill("A walk in the hills");
  await page.getByLabel("Add a photo").setInputFiles({ name: "hills.png", mimeType: "image/png", buffer: png });
  await expect(page.getByText("Photo added.")).toBeVisible();
  await page.getByRole("button", { name: "Post", exact: true }).click();
  const mine = page.getByRole("article", { name: "Post by You" });
  await expect(mine).toContainText("A walk in the hills");
  await expect(mine.getByRole("img", { name: "Photo 1 of 1 in this post" })).toBeVisible();
  await page.reload();
  await expect(mine.getByRole("img", { name: "Photo 1 of 1 in this post" })).toBeVisible();
  const first = posts.first();
  await first.getByRole("button", { name: "Like · 0" }).click();
  await expect(first.getByRole("button", { name: "Liked · 1" })).toBeVisible();
  await first.getByRole("button", { name: "Comments · 0" }).click();
  await first.getByLabel("Add a comment").fill("Lovely update");
  await first.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(first.getByRole("region", { name: "Comments" })).toContainText("Lovely update");
  await expect(first.getByRole("button", { name: "Comments · 1" })).toBeVisible();
  await mine.getByRole("button", { name: "Edit post" }).click();
  await mine.getByLabel("Edit post").fill("A long walk in the hills");
  await mine.getByRole("button", { name: "Save post" }).click();
  await expect(mine).toContainText("A long walk in the hills");
  await expect(mine).toContainText("Edited");
  await shots(page, "feed");
  await expect(page.locator("body")).not.toContainText(INTERNAL);
  await mine.getByRole("button", { name: "Delete post" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete post" }).click();
  await expect(mine).toHaveCount(0);
  await page.goto("/profiles/e2e_friend");
  await expect(page.getByRole("article", { name: "Post by Priya Shah" }).first()).toContainText("Update 21");
  await shots(page, "profile-posts");
});

test("feed: a reported post goes to reviewers with its words, and hiding removes it; blocking removes a person", async ({ page }) => {
  await signIn(page, "e2e_reporter");
  await member(page, "e2e_spammer", "Spam Account");
  await feed(page, "e2e_reporter", { action: "follow", person: "e2e_spammer" });
  await feed(page, "e2e_spammer", { action: "post", text: "Buy cheap things now" });
  await feed(page, "e2e_spammer", { action: "post", text: "Ordinary update" });
  await page.goto("/feed");
  const card = page.getByRole("article", { name: "Post by Spam Account" }).filter({ hasText: "Buy cheap things now" });
  await card.getByText("Report post").click();
  await card.getByLabel("Why are you reporting this?").fill("This is spam");
  await card.getByRole("button", { name: "Send report" }).click();
  await expect(card.getByText("Report sent.")).toBeVisible();
  await signIn(page, "mbr_owner");
  await page.goto("/moderation");
  const queue = page.getByRole("region", { name: "Moderator queue" });
  await expect(queue).toContainText("Community post");
  await expect(queue).toContainText("Buy cheap things now");
  await expect(page.locator("body")).not.toContainText(INTERNAL);
  await queue.getByRole("button", { name: "Hide item" }).first().click();
  await expect(queue.getByRole("status")).toHaveText("Review saved.");
  await signIn(page, "e2e_reporter");
  await page.goto("/feed");
  await expect(page.getByText("Ordinary update")).toBeVisible();
  await expect(page.getByText("Buy cheap things now")).toHaveCount(0);
  await page.getByRole("article", { name: "Post by Spam Account" }).getByRole("button", { name: "Block person" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Block person" }).click();
  await expect(page.getByText("Ordinary update")).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("Nothing here yet")).toBeVisible();
  await page.goto("/profiles/e2e_spammer");
  await expect(page.locator("main").getByRole("alert")).toContainText("This profile isn't available.");
  await expect(page.getByRole("region", { name: "Posts" })).toHaveCount(0);
});

test("messaging: start from a profile, Enter sends, new messages arrive without a reload, unread, read, report, block", async ({ page }) => {
  await signIn(page, "e2e_chatter");
  await member(page, "e2e_pen_pal", "Noor Ali");
  await page.goto("/profiles/e2e_pen_pal");
  await page.getByRole("link", { name: "Message", exact: true }).click();
  const conversation = page.getByRole("region", { name: "Conversation with Noor Ali" });
  await expect(conversation).toBeVisible();
  const box = conversation.getByLabel("Your message");
  await box.fill("First line");
  await box.press("Shift+Enter");
  await box.pressSequentially("Second line");
  await expect(box).toHaveValue("First line\nSecond line");
  await box.press("Enter");
  const log = conversation.getByRole("log", { name: "Messages" });
  await expect(log).toContainText("Second line");
  await expect(box).toHaveValue("");
  const { conversations } = await (await page.request.get("/api/pramaan/messages", { headers: as("e2e_pen_pal") })).json();
  const id = conversations[0].id;
  expect(conversations[0].unread).toBe(1);
  expect((await message(page, "e2e_pen_pal", { action: "read", id })).ok()).toBeTruthy();
  await expect(log).toContainText("Read", { timeout: 8_000 });
  expect((await message(page, "e2e_pen_pal", { action: "send", id, text: "Arrived on its own" })).ok()).toBeTruthy();
  await expect(log).toContainText("Arrived on its own", { timeout: 8_000 });
  await shots(page, "messages");
  await expect(page.locator("body")).not.toContainText(INTERNAL);
  await page.goto("/messages");
  await expect(page.getByRole("region", { name: "Conversations" })).toContainText("Arrived on its own");
  await message(page, "e2e_pen_pal", { action: "send", id, text: "One more" });
  await expect(page.getByText("1 unread")).toBeVisible({ timeout: 8_000 });
  await page.getByRole("button", { name: /Noor Ali/ }).click();
  await expect(page.getByText("1 unread")).toHaveCount(0, { timeout: 8_000 });
  await log.getByText("Report message").last().click();
  await log.getByLabel("Why are you reporting this?").last().fill("Unwanted message");
  await log.getByRole("button", { name: "Send report" }).last().click();
  await expect(log.getByText("Report sent.")).toBeVisible();
  await conversation.getByRole("button", { name: "Block person" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Block person" }).click();
  await expect(page.getByText("No conversations yet")).toBeVisible();
  expect((await message(page, "e2e_pen_pal", { action: "send", id, text: "Still there?" })).status()).toBe(404);
  await signIn(page, "mbr_owner");
  await page.goto("/moderation");
  await expect(page.getByRole("region", { name: "Moderator queue" })).toContainText("Private message");
});

test("signed-out visitors see a plain line, and the sample member can be tried from the demo", async ({ page }) => {
  await signIn(page, "none");
  await page.goto("/feed");
  await expect(page.getByText("Sign in to see this.").first()).toBeVisible();
  await page.goto("/messages");
  await expect(page.getByText("Your conversations are private to you.")).toBeVisible();
  await signIn(page, "e2e_demo");
  await page.goto("/messages");
  await page.getByRole("button", { name: "Hear from a sample member" }).click();
  await expect(page.getByText("1 unread")).toBeVisible({ timeout: 8_000 });
  await page.getByRole("link", { name: "Visit Sam's page" }).click();
  await expect(page.getByRole("region", { name: "Posts" }).getByRole("article").first()).toContainText("Hello from the sample community.");
});
