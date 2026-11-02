// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProfilePanel, PublicProfilePanel } from "@/components/pramaan/profiles/profile-panel";
import { ModerationPanel, SafetyActions } from "@/components/pramaan/moderation/moderation-panel";
import { resetCrmFake } from "@/lib/pramaan/crm-data";
import { saveProfile } from "@/lib/pramaan/profiles";
import { isBlocked, moderate } from "@/lib/pramaan/moderation";
import * as profiles from "@/registry/profiles/app/api/pramaan/profiles/route";
import * as moderation from "@/registry/moderation/app/api/pramaan/moderation/route";
let member = "mbr_owner";
beforeEach(() => {
  resetCrmFake(); member = "mbr_owner"; vi.stubEnv("PRAMAAN_SOCIAL_SCOPE", "demo"); vi.stubEnv("PRAMAAN_TEXT_SCREENING", "");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const request = new Request(`http://app.test${url}`, { ...init, headers: { ...(init.headers as object), cookie: `pramaan_member=${member}` } });
    const route = url.includes("/moderation") ? moderation : profiles;
    return request.method === "GET" ? route.GET(request) : route.POST(request);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("saves the editor without publishing unchecked fields", async () => {
  const user = userEvent.setup(); render(<ProfilePanel />);
  const name = await screen.findByRole("textbox", { name: "Display name" });
  await user.type(name, "Jamie"); await user.type(screen.getByRole("textbox", { name: "Short bio" }), "A private bio");
  await user.click(screen.getByRole("checkbox", { name: "Display name" }));
  await user.click(screen.getByRole("button", { name: "Save profile" }));
  await screen.findByText("Profile saved."); cleanup();
  render(<PublicProfilePanel person="mbr_owner" />);
  await screen.findByText("Jamie"); expect(screen.queryByText("A private bio")).toBeNull();
});
it("shows a signed-out explanation and retry control", async () => {
  member = "none"; render(<ProfilePanel />);
  await screen.findByRole("alert"); expect(screen.getByRole("alert").textContent).toContain("Sign in");
  expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
});
it("reports and blocks using host references without showing them", async () => {
  const user = userEvent.setup(); render(<SafetyActions kind="person" target="mbr_other" label="Jamie" />);
  await user.type(screen.getByRole("textbox", { name: "Reason" }), "Please review");
  await user.click(screen.getByRole("button", { name: "Report person" })); await screen.findByText("Report sent.");
  await user.click(screen.getByRole("button", { name: /^Block person$/ })); await screen.findByText("Person blocked.");
  expect(document.body.textContent).not.toContain("mbr_other");
  expect(await isBlocked("mbr_owner", "mbr_other", "demo")).toBe(true);
});
it("reviewers dismiss reports and see readable decision history", async () => {
  await moderate("demo", "mbr_viewer", { action: "report", kind: "item", ref: "private-item-ref", reason: "Spam" });
  const user = userEvent.setup(); render(<ModerationPanel />);
  await user.click(await screen.findByRole("button", { name: "Dismiss report" }));
  await screen.findByText("Review saved.");
  await waitFor(() => expect(screen.queryByRole("button", { name: "Dismiss report" })).toBeNull());
  expect(document.body.textContent).toContain("Reviewed by you ·");
  expect(document.body.textContent).not.toContain("mbr_");
  expect(document.body.textContent).not.toContain("private-item-ref");
});
it("a blocked public profile is unavailable", async () => {
  await saveProfile("demo", "other", { revision: 0, name: "Other", bio: "", links: [], public: { name: true, bio: false, links: false, photo: false } });
  await moderate("demo", member, { action: "block", ref: "other" }); render(<PublicProfilePanel person="other" />);
  await screen.findByRole("alert"); expect(screen.queryByText("Other")).toBeNull();
});
