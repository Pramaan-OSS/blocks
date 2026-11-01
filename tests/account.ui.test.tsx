// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountPanel } from "@/components/pramaan/account/account-panel";
import { failNext, fakeState, resetFake } from "@/lib/pramaan/fake";
import { appFetch } from "./harness";

beforeEach(() => resetFake());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const as = (member?: string) => vi.stubGlobal("fetch", appFetch(member));

describe("AccountPanel", () => {
  it("an owner sees their role in words, the team with (you), and no ids", async () => {
    as("mbr_owner");
    render(<AccountPanel />);
    const you = await screen.findByRole("region", { name: "You" });
    expect(within(you).getByText("owner@example.com")).toBeTruthy();
    expect(within(you).getByText("Owner")).toBeTruthy();
    expect(within(you).getByText(/You can approve requests/)).toBeTruthy();
    const team = screen.getByRole("list", { name: "Team members" });
    expect(within(team).getAllByRole("listitem")).toHaveLength(2);
    expect(within(team).getByText("owner@example.com (you)")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/mbr_|_micro|role\b.*:/);
  });

  it("a viewer has no team and no way to rename", async () => {
    as("mbr_viewer");
    render(<AccountPanel />);
    expect(await screen.findByText("Only owners and admins see the team")).toBeTruthy();
    expect(screen.queryByLabelText("Organisation name")).toBeNull();
    expect(screen.getByText("Only an owner or an admin can change it.")).toBeTruthy();
    expect(screen.getByText(/You can't approve requests/)).toBeTruthy();
  });

  it("an owner renames the organisation and sees it saved", async () => {
    as("mbr_owner");
    render(<AccountPanel />);
    const box = await screen.findByLabelText("Organisation name");
    await userEvent.type(box, "Acme Ltd");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Saved.")).toBeTruthy();
    expect(fakeState().requests.filter((r) => r.method === "PUT")).toHaveLength(1);
  });

  it("shows the API's own refusal for a name", async () => {
    as("mbr_owner");
    render(<AccountPanel />);
    await userEvent.type(await screen.findByLabelText("Organisation name"), "mail me@acme.com");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("The name can't contain an email address.")).toBeTruthy();
  });

  it("signed out: asks to sign in. A load failure has Try again", async () => {
    as("none");
    render(<AccountPanel />);
    expect(await screen.findByText("Sign in to see this.")).toBeTruthy();
    cleanup();
    as("mbr_owner");
    failNext("GET", "/v1/organization", 502, { code: "upstream_unavailable", message: "Pramaan is busy. Try again." });
    render(<AccountPanel />);
    expect(await screen.findByText("Pramaan is busy. Try again.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});
