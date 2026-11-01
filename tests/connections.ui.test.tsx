// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionReturn, ConnectionsManager } from "@/components/pramaan/connections/connections-manager";
import { completeFakeConnection, failNext, resetFake } from "@/lib/pramaan/fake";
import { appFetch, get, post } from "./harness";

beforeEach(() => {
  resetFake();
  vi.stubGlobal("fetch", appFetch("mbr_owner"));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const row = (name: string) => screen.findByRole("listitem", { name });
const buttons = (el: HTMLElement) => within(el).getAllByRole("button").map((b) => b.textContent);

describe("ConnectionsManager", () => {
  it("lists each app with its status and only the actions that fit it", async () => {
    render(<ConnectionsManager />);
    const gmail = await row("Gmail");
    expect(gmail.textContent).toContain("Connected");
    expect(gmail.textContent).toContain("pat@example.com");
    expect(gmail.textContent).toContain("Can read and change");
    expect(buttons(gmail)).toEqual(["Check", "Disconnect"]);
    const calendar = await row("Google Calendar");
    expect(calendar.textContent).toContain("Needs reconnect");
    expect(buttons(calendar)).toEqual(["Reconnect", "Check", "Disconnect", "Remove"]);
    const github = await row("GitHub");
    expect(github.textContent).toContain("Revoked");
    expect(buttons(github)).toEqual(["Connect again"]);
    const outlook = await row("Outlook");
    expect(outlook.textContent).toContain("Not connected");
    expect(outlook.textContent).toContain("Connects your own Outlook.");
    expect(buttons(outlook)).toEqual(["Connect"]);
  });

  it("Connect opens the sign-in link, which leads back to the return page", async () => {
    const navigate = vi.fn();
    const user = userEvent.setup();
    render(<ConnectionsManager navigate={navigate} />);
    await user.click(within(await row("Outlook")).getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledOnce());
    const url = new URL(navigate.mock.calls[0][0]);
    expect(url.pathname).toBe("/api/demo/connect");
    expect(url.searchParams.get("redirect")).toBe("http://app.test/connections/return?app=outlook");
  });

  it("Check re-reads the connection and says who it is connected as", async () => {
    const user = userEvent.setup();
    render(<ConnectionsManager />);
    await user.click(within(await row("Gmail")).getByRole("button", { name: "Check" }));
    expect(await screen.findByText("Gmail is connected as pat@example.com.")).toBeTruthy();
  });

  it("Disconnect asks first, then the app reads revoked", async () => {
    const user = userEvent.setup();
    render(<ConnectionsManager />);
    await user.click(within(await row("Gmail")).getByRole("button", { name: "Disconnect" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("Its access is revoked");
    await user.click(within(dialog).getByRole("button", { name: "Disconnect" }));
    expect(await screen.findByText("Gmail is disconnected and its access is revoked.")).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("listitem", { name: "Gmail" }).textContent).toContain("Revoked"));
    expect(buttons(screen.getByRole("listitem", { name: "Gmail" }))).toEqual(["Connect again"]);
  });

  it("Remove waits in the approvals inbox, and the connection goes once it is approved", async () => {
    const user = userEvent.setup();
    render(<ConnectionsManager approvalsHref="/inbox" />);
    await user.click(within(await row("Google Calendar")).getByRole("button", { name: "Remove" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("saved credentials");
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));
    expect(await screen.findByText(/sent for approval/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open the approvals inbox" }).getAttribute("href")).toBe("/inbox");
    const inbox = await (await get("mbr_owner", "/api/pramaan/approvals")).json();
    const wait = inbox.results.find((a: { capability: string }) => a.capability === "apps.connection.delete");
    await post("mbr_owner", `/api/pramaan/approvals/${wait.approval_id}/decide`, { decision: "approve" });
    await user.click(within(await row("Gmail")).getByRole("button", { name: "Check" }));
    await waitFor(() => expect(screen.getByRole("listitem", { name: "Google Calendar" }).textContent).toContain("Not connected"));
  });

  it("lists the workspace accounts with their status", async () => {
    render(<ConnectionsManager />);
    const table = await screen.findByRole("table", { name: "Workspace accounts" });
    const rows = within(table).getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell").map((c) => c.textContent));
    expect(rows).toEqual([["Support inbox", "Mail", "Connected"], ["Sender line", "Messaging", "Connected"], ["Team calendar", "Calendar", "Disconnected"]]);
  });

  it("shows the server's own message when the list fails", async () => {
    failNext("GET", "/v1/accounts", 429, { code: "rate_limited", message: "Too many requests. Wait a minute, then try again." });
    render(<ConnectionsManager />);
    expect((await screen.findByRole("alert")).textContent).toContain("Too many requests. Wait a minute, then try again.");
  });
});

describe("ConnectionReturn", () => {
  it("re-checks the status after sign-in and says connected", async () => {
    await post("mbr_owner", "/api/pramaan/connections/start", { app: "outlook" });
    completeFakeConnection("user-42", "outlook");
    render(<ConnectionReturn app="outlook" everyMs={10} />);
    expect(await screen.findByText("Outlook is connected.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to your connections" }).getAttribute("href")).toBe("/connections");
  });

  it("waits for a late sign-in, then gives a check-again when it never arrives", async () => {
    await post("mbr_owner", "/api/pramaan/connections/start", { app: "outlook" });
    const user = userEvent.setup();
    render(<ConnectionReturn app="outlook" attempts={2} everyMs={10} />);
    expect(await screen.findByText(/Outlook isn't connected yet/)).toBeTruthy();
    completeFakeConnection("user-42", "outlook");
    await user.click(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByText("Outlook is connected.")).toBeTruthy();
  });
});
