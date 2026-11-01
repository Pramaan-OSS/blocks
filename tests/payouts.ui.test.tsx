// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PayoutsPanel } from "@/components/pramaan/payouts/payouts-panel";
import { fakeState, resetFake } from "@/lib/pramaan/fake";
import { setFakeAccount } from "@/lib/pramaan/fake-wave3";
import { appFetch } from "./harness";

beforeEach(() => resetFake());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// The panel reaches the app's own routes; /api/demo (the stand-in's button) is served here too.
function open(member: string) {
  const app = appFetch(member);
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (url === "/api/demo") {
      setFakeAccount(fakeState(), { status: "ready" });
      return Response.json({ ok: true });
    }
    return app(url, init);
  });
  render(<PayoutsPanel />);
}

describe("PayoutsPanel", () => {
  it("shows where the account stands and what is still needed, with no keys or ids", async () => {
    open("mbr_owner");
    expect(await screen.findByText("Setting up")).toBeTruthy();
    expect(screen.getByText("A bank account to receive payouts")).toBeTruthy();
    expect(screen.getByRole("list", { hidden: false }).textContent).not.toMatch(/external_account/);
    expect(document.body.textContent).not.toMatch(/stripe|pk_test|fake_secret/i);
    expect(screen.getByRole("button", { name: "Set up payments" })).toBeTruthy();
  });

  it("opens the setup screen (a marked stand-in on the fake) and ends ready", async () => {
    const user = userEvent.setup();
    open("mbr_owner");
    await user.click(await screen.findByRole("button", { name: "Set up payments" }));
    const setup = await screen.findByRole("region", { name: "Payment setup" });
    expect(setup.textContent).toContain("Demo stand-in");
    await user.click(screen.getByRole("button", { name: "Finish setup" }));
    expect(await screen.findByText("Ready")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Payment setup" })).toBeNull();
    expect(screen.getByText("You can take payments and receive payouts.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Manage payouts" })).toBeTruthy();
  });

  it("a blocked account says so and offers to give the missing details", async () => {
    setFakeAccount(fakeState(), { status: "restricted", due: ["tos_acceptance"] });
    open("mbr_owner");
    expect(await screen.findByText("Blocked")).toBeTruthy();
    expect(screen.getByText("Accept the terms of service")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Give the missing details" })).toBeTruthy();
  });

  it("a member who can't manage sees the status but no button, and is told why", async () => {
    open("mbr_viewer");
    await screen.findByText("Setting up");
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Only an owner or admin can change payment settings.")).toBeTruthy();
  });

  it("nobody signed in gets the server's message", async () => {
    open("none");
    expect(await screen.findByText("Sign in to see this.")).toBeTruthy();
  });
});
