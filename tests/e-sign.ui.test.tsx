// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SendForSignature, SigningList } from "@/components/pramaan/signing/signing-flow";
import { fakeState, resetFake } from "@/lib/pramaan/fake";
import { DEMO_DOCUMENT_ID, fakeReminders, signFakeSignature } from "@/lib/pramaan/fake-wave3";
import { appFetch, post } from "./harness";

const docs = [{ fileId: DEMO_DOCUMENT_ID, filename: "agreement.pdf", label: "Sample agreement" }];

beforeEach(() => {
  resetFake();
  vi.stubGlobal("fetch", appFetch());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const sendOne = async () => {
  const res = await post(undefined, "/api/pramaan/signing", { title: "NDA", fileId: DEMO_DOCUMENT_ID, filename: "nda.pdf", signers: [{ name: "Pat Lee", email: "pat@example.com" }] });
  return ((await res.json()) as { ref: string }).ref;
};

describe("SendForSignature", () => {
  it("sends once even on a double click, then clears the form and says what happens next", async () => {
    render(<SendForSignature documents={docs} />);
    await userEvent.type(screen.getByLabelText("Title"), "NDA");
    await userEvent.type(screen.getByLabelText("Name 1"), "Pat Lee");
    await userEvent.type(screen.getByLabelText("Email 1"), "pat@example.com");
    await userEvent.dblClick(screen.getByRole("button", { name: "Send for signing" }));
    await screen.findByText(/Each person got an email/);
    expect(fakeState().requests.filter((r) => r.path.endsWith("signature.request.send"))).toHaveLength(1);
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("");
  });

  it("adds and removes people, and shows the server's own message when it refuses", async () => {
    render(<SendForSignature documents={docs} />);
    await userEvent.click(screen.getByRole("button", { name: "Add another person" }));
    expect(screen.getByLabelText("Name 2")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Remove person 2" }));
    expect(screen.queryByLabelText("Name 2")).toBeNull();
    await userEvent.type(screen.getByLabelText("Title"), "NDA");
    await userEvent.type(screen.getByLabelText("Name 1"), "Pat");
    await userEvent.type(screen.getByLabelText("Email 1"), "pat@example.com");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { code: "invalid_request", message: "fileId must be the id of a file you uploaded." } }, { status: 400 })));
    await userEvent.click(screen.getByRole("button", { name: "Send for signing" }));
    expect(await screen.findByText("fileId must be the id of a file you uploaded.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Send for signing" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("says so when there is no document to send", () => {
    render(<SendForSignature documents={[]} />);
    expect(screen.getByText("No document to send")).toBeTruthy();
  });
});

describe("SigningList", () => {
  it("is empty at first", async () => {
    render(<SigningList pollMs={0} />);
    expect(await screen.findByText("Nothing sent yet")).toBeTruthy();
  });

  it("shows where each signer stands, asks before a reminder and sends it", async () => {
    await sendOne();
    render(<SigningList pollMs={0} />);
    await userEvent.click(await screen.findByRole("button", { name: "Open NDA" }));
    const signers = within(await screen.findByRole("list", { name: "Signers" }));
    expect(signers.getByText("Hasn't opened it")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Remind Pat Lee" }));
    expect(fakeState().requests.some((r) => r.path.endsWith("signature.request.remind"))).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Send reminder" }));
    expect(await screen.findByText("Reminder sent to Pat Lee.")).toBeTruthy();
  });

  it("offers the signed copy only when everyone has signed, and never shows a reference", async () => {
    const ref = await sendOne();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(<SigningList pollMs={0} />);
    await userEvent.click(await screen.findByRole("button", { name: "Open NDA" }));
    await screen.findByRole("region", { name: "Agreement" });
    expect(screen.queryByRole("button", { name: "Open the signed copy" })).toBeNull();
    expect(document.body.textContent).not.toMatch(/ref_FAKE/);
    cleanup();
    signFakeSignature(fakeState(), ref, "pat@example.com");
    render(<SigningList pollMs={0} />);
    await userEvent.click(await screen.findByRole("button", { name: "Open NDA" }));
    expect(await screen.findByText("Signed by everyone")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Open the signed copy" }));
    await waitFor(() => expect(open).toHaveBeenCalledWith(expect.stringMatching(/^data:application\/pdf/), "_blank", "noopener"));
    expect(fakeReminders(fakeState(), ref)).toBe(0);
  });
});
