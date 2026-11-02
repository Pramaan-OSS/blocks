import { test, expect } from "@playwright/test";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhH0AAAAASUVORK5CYII=", "base64");
test("profiles: edit, upload, publish selected fields and preserve privacy on reload", async ({ page, context }) => {
  await page.goto("/profiles");
  await page.getByRole("textbox", { name: "Display name", exact: true }).fill("Jamie Reed");
  await page.getByRole("textbox", { name: "Short bio", exact: true }).fill("Private biography for testing");
  await page.getByLabel("Links, one per line").fill("https://example.com/");
  const visible = page.getByRole("group", { name: "Show on your public page" });
  await visible.getByLabel("Display name", { exact: true }).check();
  await visible.getByLabel("Short bio", { exact: true }).uncheck();
  await visible.getByLabel("Links", { exact: true }).check();
  await visible.getByLabel("Photo", { exact: true }).check();
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByRole("status")).toHaveText("Profile saved.");
  await page.getByLabel("Upload photo").setInputFiles({ name: "portrait.png", mimeType: "image/png", buffer: png });
  await expect(page.getByRole("status")).toHaveText("Photo uploaded.");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Short bio", exact: true })).toHaveValue("Private biography for testing");
  for (const mode of ["light", "dark"]) {
    await page.setViewportSize({ width: 1142, height: 732 });
    await page.evaluate(mode => document.documentElement.classList.toggle("dark", mode === "dark"), mode);
    await page.screenshot({ path: `.scratch/b1/profile-editor-${mode}.png` });
  }
  await page.getByRole("link", { name: "View public page" }).click();
  await expect(page.getByRole("article", { name: "Public profile" })).toContainText("Jamie Reed");
  await expect(page.getByRole("img", { name: "Profile photo" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Private biography");
  await context.addCookies([{ name: "pramaan_member", value: "none", domain: "localhost", path: "/" }]);
  await page.reload();
  expect((await page.request.get("/api/pramaan/profiles")).status()).toBe(401);
  await expect(page.getByRole("article", { name: "Public profile" })).toContainText("Jamie Reed");
  for (const mode of ["light", "dark"]) {
    await page.setViewportSize({ width: 1142, height: 732 });
    await page.evaluate(mode => document.documentElement.classList.toggle("dark", mode === "dark"), mode);
    await page.screenshot({ path: `.scratch/b1/profiles-${mode}.png` });
  }
});
test("moderation: report, review, hide and dismiss with readable history", async ({ page }) => {
  await page.goto("/moderation");
  const item = page.getByRole("region", { name: "Safety for Sample community post" });
  await item.getByLabel("Reason").fill("Spam in the sample post");
  await item.getByRole("button", { name: "Report item" }).click();
  await expect(item.getByRole("status")).toHaveText("Report sent.");
  await page.reload();
  const queue = page.getByRole("region", { name: "Moderator queue" });
  await expect(queue).toContainText("Spam in the sample post");
  await queue.getByRole("button", { name: "Hide item" }).first().click();
  await expect(queue.getByRole("status")).toHaveText("Review saved.");
  await expect(queue).toContainText("Hidden");
  await page.reload();
  await expect(page.getByText("The sample post is hidden.")).toBeVisible();
  await expect(queue).toContainText("Reviewed by you ·");
  const person = page.getByRole("region", { name: "Safety for Sample community member" });
  await person.getByLabel("Reason").fill("Please review this account");
  await person.getByRole("button", { name: "Report person" }).click();
  await expect(person.getByRole("status")).toHaveText("Report sent.");
  await page.reload();
  await queue.getByRole("button", { name: "Dismiss report" }).first().click();
  await expect(queue.getByRole("status")).toHaveText("Review saved.");
  await expect(queue).toContainText("Dismissed");
  await expect(page.locator("body")).not.toContainText(/mbr_|demo-item|decidedBy|text\.classify/);
  for (const mode of ["light", "dark"]) {
    await page.setViewportSize({ width: 1142, height: 732 });
    await page.evaluate(mode => document.documentElement.classList.toggle("dark", mode === "dark"), mode);
    await page.screenshot({ path: `.scratch/b1/moderation-${mode}.png` });
  }
});
test("blocking hides the person's profile only for the blocker", async ({ page, context }) => {
  const response = await page.request.post("/api/pramaan/profiles", { data: { revision: 0, name: "Other member", bio: "", links: [], public: { name: true, bio: false, links: false, photo: false } }, headers: { cookie: "pramaan_member=mbr_sample" } });
  expect(response.ok()).toBeTruthy();
  await page.goto("/profiles/mbr_sample");
  await expect(page.getByRole("article")).toContainText("Other member");
  await page.goto("/moderation");
  const person = page.getByRole("region", { name: "Safety for Sample community member" });
  await person.getByRole("button", { name: "Block person", exact: true }).click();
  await expect(person.getByRole("status")).toHaveText("Person blocked.");
  await page.goto("/profiles/mbr_sample");
  await expect(page.locator("main").getByRole("alert")).toContainText("This profile isn't available.");
  await context.addCookies([{ name: "pramaan_member", value: "mbr_viewer", domain: "localhost", path: "/" }]);
  await page.reload();
  await expect(page.getByRole("article")).toContainText("Other member");
});
test("non-moderators cannot view reports and signed-out people cannot edit", async ({ page, context }) => {
  await context.addCookies([{ name: "pramaan_member", value: "mbr_viewer", domain: "localhost", path: "/" }]);
  await page.goto("/moderation");
  await expect(page.locator("main").getByRole("alert")).toContainText("Only owners and admins");
  await expect(page.getByRole("button", { name: "Hide item" })).toHaveCount(0);
  await context.addCookies([{ name: "pramaan_member", value: "none", domain: "localhost", path: "/" }]);
  await page.goto("/profiles");
  await expect(page.locator("main").getByRole("alert")).toContainText("Sign in to continue.");
});
