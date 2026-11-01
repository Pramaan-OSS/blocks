import { chromium, expect, test } from "@playwright/test";
import { BASE } from "./base";

// Headless only: never a visible browser window.
test("upload: choose a file, watch it finish, find it in the list, open it, delete it", async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ baseURL: BASE })).newPage();
  await page.request.post("/api/demo", { data: { action: "reset" } });

  await page.goto("/upload");
  await expect(page.getByText("No files yet")).toBeVisible();
  await page.getByLabel("Choose files").setInputFiles({ name: "contract.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 hello") });
  const uploads = page.getByRole("list", { name: "Uploads" });
  await expect(uploads).toContainText("Uploaded");
  const files = page.getByRole("list", { name: "Files" });
  await expect(files).toContainText("contract.pdf");
  await expect(files).toContainText("PDF document");

  const href = await files.getByRole("link", { name: "Open contract.pdf" }).getAttribute("href");
  const served = await page.request.get(href!);
  expect(served.status()).toBe(200);
  expect(await served.text()).toBe("%PDF-1.4 hello");

  await page.getByLabel("Choose files").setInputFiles({ name: "notes.zip", mimeType: "application/zip", buffer: Buffer.from("x") });
  await expect(page.getByText(/isn't supported/)).toBeVisible();

  await files.getByRole("button", { name: "Delete contract.pdf" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText("contract.pdf was deleted.")).toBeVisible();
  await expect(page.getByText("No files yet")).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/file_FAKE/);
  await browser.close();
});
