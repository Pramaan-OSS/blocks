// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConsentBadge, ConsentManager, UnsubscribePage } from "@/components/pramaan/consent/consent-manager";
import { resetFake } from "@/lib/pramaan/fake";
import { appFetch } from "./harness";

beforeEach(() => {
  resetFake();
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function open(member = "mbr_owner") {
  vi.stubGlobal("fetch", appFetch(member));
  const user = userEvent.setup();
  render(<ConsentManager />);
  await screen.findByRole("list", { name: "Opt-outs" });
  return user;
}

describe("ConsentManager", () => {
  it("lists opt-outs in words with shortened addresses, and no ids", async () => {
    await open();
    const list = screen.getByRole("list", { name: "Opt-outs" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(list.textContent).toContain("+14…00");
    expect(list.textContent).toContain("Text messages");
    expect(list.textContent).toContain("They unsubscribed");
    expect(list.textContent).toContain("Asked by phone");
    expect(document.body.textContent).not.toMatch(/opt_FAKE|stop_FAKE|14155550100|pat@example/);
    const stops = screen.getByRole("region", { name: "Replied STOP" });
    expect(stops.textContent).toContain("They replied STOP");
    expect(within(stops).queryAllByRole("button")).toHaveLength(0);
  });

  it("searches the list", async () => {
    const user = await open();
    await user.type(screen.getByLabelText("Search the list"), "pat");
    await waitFor(() => expect(within(screen.getByRole("list", { name: "Opt-outs" })).getAllByRole("listitem")).toHaveLength(1));
    await user.clear(screen.getByLabelText("Search the list"));
    await user.type(screen.getByLabelText("Search the list"), "zzz");
    expect(await screen.findByText("Nothing matches")).toBeTruthy();
  });

  it("checks a contact and says in words whether a message would go through", async () => {
    const user = await open();
    const form = screen.getByRole("form", { name: "Check a contact" });
    await user.type(within(form).getByLabelText("Phone number or email"), "+14155550100");
    await user.click(within(form).getByRole("button", { name: "Check" }));
    expect((await within(form).findByRole("status")).textContent).toContain("Text messages to this contact would be refused: they opted out.");
    await user.selectOptions(within(form).getByLabelText("How you would reach them"), "whatsapp");
    await user.click(within(form).getByRole("button", { name: "Check" }));
    await waitFor(() => expect(within(form).getByRole("status").textContent).toContain("WhatsApp to this contact would go through."));
  });

  it("adds an opt-out and shows it in the list", async () => {
    const user = await open();
    const form = screen.getByRole("form", { name: "Add an opt-out" });
    await user.type(within(form).getByLabelText(/Phone number or email/), "+14155550177");
    await user.type(within(form).getByLabelText(/Why/), "Asked by letter");
    await user.click(within(form).getByRole("button", { name: "Add opt-out" }));
    expect(await within(form).findByText(/Every channel to this contact are now blocked/)).toBeTruthy();
    await waitFor(() => expect(within(screen.getByRole("list", { name: "Opt-outs" })).getAllByRole("listitem")).toHaveLength(4));
    expect(screen.getByText("Asked by letter", { exact: false })).toBeTruthy();
  });

  it("requests approval by row handle without asking for the full address", async () => {
    const user = await open();
    const rows = within(screen.getByRole("list", { name: "Opt-outs" })).getAllByRole("listitem");
    expect(within(rows[1]).queryByRole("button", { name: /Remove/ })).toBeNull();
    await user.click(within(rows[0]).getByRole("button", { name: /Remove/ }));
    const form = screen.getByRole("form", { name: /be messaged again/ });
    expect(within(form).queryByRole("textbox")).toBeNull();
    await user.click(within(form).getByRole("button", { name: "Let them be messaged again" }));
    expect(await screen.findByText(/Removal is waiting for approval/)).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Opt-outs" })).getAllByRole("listitem")).toHaveLength(3);
  });

  it("lets signed-in members request a removal that still needs approval", async () => {
    await open("mbr_viewer");
    expect(screen.getAllByRole("button", { name: /Remove/ })).toHaveLength(2);
  });

  it("the badge says OK to message or opted out", async () => {
    vi.stubGlobal("fetch", appFetch("mbr_owner"));
    render(<><ConsentBadge address="+14155550100" channel="sms" /><ConsentBadge address="+14155550100" channel="voice" /></>);
    expect(await screen.findByText("Opted out of text messages")).toBeTruthy();
    expect(await screen.findByText("OK to message")).toBeTruthy();
  });

  it("unsubscribes the signed recipient without asking for their address", async () => {
    vi.stubGlobal("fetch", appFetch());
    const user = userEvent.setup();
    render(<UnsubscribePage link="http://pramaan.fake/unsubscribe/recipient_demo" />);
    expect(screen.queryByRole("textbox")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Unsubscribe" }));
    expect((await screen.findByRole("status")).textContent).toContain("You are unsubscribed");
  });

  it("explains that a signed link is required when opened without one", async () => {
    render(<UnsubscribePage />);
    expect(screen.getByText(/Open the unsubscribe link in your message/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Unsubscribe" })).toBeNull();
  });

});
