// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { actionName } from "@/lib/pramaan/plain";
import { ApprovalInbox } from "@/components/pramaan/approvals/approval-inbox";
import { ApprovalsBadge } from "@/components/pramaan/approvals/approvals-badge";
import { addFakeApproval, failNext, fakeState, resetFake } from "@/lib/pramaan/fake";
import { appFetch } from "./harness";

beforeEach(() => {
  resetFake();
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function open(member: string | undefined, capability = "email.send") {
  const fetch = appFetch(member);
  vi.stubGlobal("fetch", fetch);
  const user = userEvent.setup();
  render(<ApprovalInbox />);
  const list = await screen.findByRole("list", { name: "Requests waiting for approval" });
  await user.click(within(list).getAllByRole("button").find((b) => b.textContent?.includes(actionName(capability)))!);
  await screen.findByLabelText("What it will use");
  return { fetch, user };
}

const decideCalls = (fetch: ReturnType<typeof appFetch>) =>
  fetch.mock.calls.filter(([url]) => String(url).endsWith("/decide"));

describe("ApprovalInbox", () => {
  it("approves once; a double click and a second try never run it again", async () => {
    const { fetch, user } = await open("mbr_owner");
    const id = [...fakeState().approvals.values()].find((a) => a.capability === "email.send")!.id;

    await user.click(screen.getByRole("button", { name: "Approve" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/costs less than \$0\.01/)).toBeTruthy();
    expect(within(dialog).getByLabelText("What it will use").textContent).toContain("pat@example.com");
    await user.dblClick(within(dialog).getByRole("button", { name: "Approve" }));

    await screen.findByText("Approved. The call runs once.");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Approve" })).toBeNull());
    expect(decideCalls(fetch)).toHaveLength(1);
    const [, init] = decideCalls(fetch)[0];
    expect(new Headers(init?.headers).get("Idempotency-Key")).toMatch(/^[0-9a-f-]{36}$/);
    expect(fakeState().approvals.get(id)?.runs).toBe(1);

    await user.click(screen.getByRole("tab", { name: "History" }));
    const history = await screen.findByRole("list", { name: "Your decisions" });
    // In words, never the id: what was decided, and the id only as a hook for tests.
    expect(within(history).getByText("Send an email")).toBeTruthy();
    expect(history.textContent).toContain("Approved");
    expect(history.textContent).not.toContain(id);
    expect(history.querySelector(`[data-approval-id="${id}"]`)).toBeTruthy();
  });

  it("shows the request in plain words: no raw JSON, no ids, an id only behind Copy reference", async () => {
    const id = addFakeApproval({
      capability: "company.research",
      priceMicro: 0,
      input: { accountId: "acc_mail1", options: { depth: "deep", sources: ["news", "site"] } },
      requestedBy: { kind: "key", member_id: "mbr_viewer" },
    });
    vi.stubGlobal("fetch", appFetch("mbr_owner"));
    const user = userEvent.setup();
    render(<ApprovalInbox />);
    await user.click(await screen.findByRole("button", { name: /Research a company/ }));
    const detail = await screen.findByRole("region", { name: "Request details" });
    const fields = await within(detail).findByLabelText("What it will use");
    expect(fields.textContent).toContain("Account");
    expect(fields.textContent).toContain("Depth");
    expect(fields.textContent).toContain("news, site");
    expect(detail.textContent).not.toMatch(/[{}]|acc_mail1|mbr_viewer|company\.research/);
    expect(detail.textContent).not.toContain(id);
    expect(within(detail).getAllByRole("button", { name: "Copy reference" }).length).toBeGreaterThan(0);
  });

  it("shows an expired item as expired, with no Approve button", async () => {
    addFakeApproval({ capability: "social.post.publish", input: { text: "Launch day" }, expiresAt: Date.now() + 1_500 });
    await open("mbr_owner", "social.post.publish");
    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Approve" })).toBeNull(), { timeout: 4_000 });
    expect(screen.getByText(/It can't be approved now/)).toBeTruthy();
  });

  it("shows a read-only member no Approve or Decline buttons", async () => {
    await open("mbr_viewer");
    expect(screen.getByText("You can see these requests, but only an approver can decide them.")).toBeTruthy();
    expect(screen.getByText("Read only: only an approver can decide this.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Decline" })).toBeNull();
  });

  it("shows the server's own message when a decision is refused", async () => {
    const { user } = await open("mbr_owner");
    const id = [...fakeState().approvals.values()].find((a) => a.capability === "email.send")!.id;
    failNext("POST", `/v1/approvals/${id}/decide`, 409, {
      code: "conflict",
      message: "This approval was already decided, or it has expired.",
    });
    await user.click(screen.getByRole("button", { name: "Approve" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Approve" }));
    expect(await screen.findByText("Already decided. This approval was already decided, or it has expired.")).toBeTruthy();
    expect(fakeState().approvals.get(id)?.runs).toBe(0);
  });

  it("shows the server's own message when the list fails", async () => {
    failNext("GET", "/v1/approvals", 402, {
      code: "spend_cap_reached",
      message: "Not enough credit for this call.",
      next: "Add credit, then try again.",
    });
    vi.stubGlobal("fetch", appFetch("mbr_owner"));
    render(<ApprovalInbox />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Not enough credit for this call.");
    expect(alert.textContent).toContain("Add credit, then try again.");
  });

  it("shows the empty state", async () => {
    for (const a of fakeState().approvals.values()) a.status = "denied";
    vi.stubGlobal("fetch", appFetch("mbr_owner"));
    render(<ApprovalInbox />);
    expect(await screen.findByText("Nothing is waiting for you")).toBeTruthy();
  });
});

describe("ApprovalsBadge", () => {
  it("counts what is waiting", async () => {
    vi.stubGlobal("fetch", appFetch("mbr_viewer"));
    render(<ApprovalsBadge />);
    expect((await screen.findByLabelText("2 requests waiting for approval")).textContent).toBe("2");
  });
});
