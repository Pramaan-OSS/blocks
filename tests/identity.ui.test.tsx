// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IdentityCheck } from "@/components/pramaan/identity/identity-check";
import { failNext, fakeState, resetFake } from "@/lib/pramaan/fake";
import { finishFakeVerification } from "@/lib/pramaan/fake-wave3";
import { appFetch } from "./harness";

beforeEach(() => {
  resetFake();
  vi.stubGlobal("fetch", appFetch("mbr_owner"));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const refOf = () => [...fakeState().wave3!.verifications.keys()][0];

describe("IdentityCheck", () => {
  it("starts the check and shows the provider's screen in the page, with a new-tab way out", async () => {
    render(<IdentityCheck pollMs={30} />);
    await userEvent.click(screen.getByRole("button", { name: "Check my identity" }));
    const frame = (await screen.findByTitle("Identity check")) as HTMLIFrameElement;
    expect(frame.getAttribute("src")).toContain("/identity/stand-in");
    expect(frame.getAttribute("allow")).toContain("camera");
    expect(screen.getByRole("link", { name: "Open the check in a new tab" })).toBeTruthy();
    expect(await screen.findByText("Waiting for you")).toBeTruthy();
  });

  it("shows Verified with each check once it passes, and no personal details or ids", async () => {
    render(<IdentityCheck pollMs={30} />);
    await userEvent.click(screen.getByRole("button", { name: "Check my identity" }));
    await screen.findByText("Waiting for you");
    finishFakeVerification(fakeState(), refOf(), "approved");
    expect(await screen.findByText("Verified", {}, { timeout: 4_000 })).toBeTruthy();
    await waitFor(() => {
      const checks = screen.getByLabelText("Checks").textContent ?? "";
      expect(checks).toContain("ID documentPassed");
      expect(checks).toContain("Face matchPassed");
      expect(document.body.textContent).not.toMatch(/Lovelace|X1234567|ref_FAKE|face_match/);
      // Done: the provider's screen is gone and there is nothing more to start.
      expect(screen.queryByTitle("Identity check")).toBeNull();
      expect(screen.queryByRole("button")).toBeNull();
    });
  });

  it("a failed check says so, lists what failed and offers to try again", async () => {
    render(<IdentityCheck pollMs={30} />);
    await userEvent.click(screen.getByRole("button", { name: "Check my identity" }));
    await screen.findByText("Waiting for you");
    finishFakeVerification(fakeState(), refOf(), "declined");
    expect(await screen.findByText("Not verified")).toBeTruthy();
    expect(screen.getByLabelText("Checks").textContent).toContain("Selfie checkFailed");
    expect(await screen.findByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("a check being reviewed is not shown as verified", async () => {
    render(<IdentityCheck pollMs={30} />);
    await userEvent.click(screen.getByRole("button", { name: "Check my identity" }));
    await screen.findByText("Waiting for you");
    finishFakeVerification(fakeState(), refOf(), "in_review");
    expect(await screen.findByText("Being reviewed")).toBeTruthy();
    expect(screen.getByLabelText("Checks").textContent).toContain("Face matchNeeds a look");
    expect(screen.queryByText("Verified")).toBeNull();
  });

  it("shows the server's own message when it can't start", async () => {
    failNext("POST", "/v1/capabilities/identity.verification.create", 502, { code: "upstream_unavailable", message: "The check service is busy." });
    render(<IdentityCheck />);
    await userEvent.click(screen.getByRole("button", { name: "Check my identity" }));
    expect(await screen.findByText("The check service is busy.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Check my identity" })).toBeTruthy();
  });
});
