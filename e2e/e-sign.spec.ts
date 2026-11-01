import { chromium, expect, test } from "@playwright/test";
import { BASE } from "./base";

// Headless only: never a visible browser window.
test("e-sign: send, see waiting, remind, sign on the stand-in, then open the signed copy", async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ baseURL: BASE })).newPage();
  await page.request.post("/api/demo", { data: { action: "reset" } });

  await page.goto("/e-sign");
  await expect(page.getByText("Nothing sent yet")).toBeVisible();
  await page.getByLabel("Title").fill("Service agreement");
  await page.getByLabel("Name 1").fill("Pat Lee");
  await page.getByLabel("Email 1").fill("pat@example.com");
  await page.getByRole("button", { name: "Add another person" }).click();
  await page.getByLabel("Name 2").fill("Sam Roy");
  await page.getByLabel("Email 2").fill("sam@example.com");
  await page.getByRole("button", { name: "Send for signing" }).click();
  await expect(page.getByText(/Each person got an email/)).toBeVisible();
  const list = page.getByRole("list", { name: "Agreements" });
  await expect(list).toContainText("Waiting for signatures");

  await list.getByRole("button", { name: "Open Service agreement" }).click();
  await page.getByRole("button", { name: "Remind Sam Roy" }).click();
  await page.getByRole("button", { name: "Send reminder" }).click();
  await expect(page.getByText("Reminder sent to Sam Roy.")).toBeVisible();
  await page.getByRole("button", { name: "Back to the list" }).click();

  const stand = page.getByRole("region", { name: "Signing page" });
  await expect(stand.getByText("Demo stand-in")).toBeVisible();
  for (const email of ["pat@example.com", "sam@example.com"]) {
    await stand.getByLabel("Signer's email").fill(email);
    await stand.getByRole("button", { name: "Sign" }).click();
  }
  await expect(list).toContainText("Signed by everyone");
  await list.getByRole("button", { name: "Open Service agreement" }).click();
  await expect(page.getByRole("button", { name: "Open the signed copy" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/ref_FAKE/);
  await browser.close();
});
