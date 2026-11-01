// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConsentBadge, ConsentManager, UnsubscribePage } from "@/components/pramaan/consent/consent-manager";
import { fakeState, resetFake } from "@/lib/pramaan/fake";
import { consent } from "@/lib/pramaan/fake-consent";
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
    await user.type(screen.getByLabelText("Search the list"), "email");
    expect(within(screen.getByRole("list", { name: "Opt-outs" })).getAllByRole("listitem")).toHaveLength(1);
    await user.clear(screen.getByLabelText("Search the list"));
    await user.type(screen.getByLabelText("Search the list"), "zzz");
    expect(screen.getByText("Nothing matches")).toBeTruthy();
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

  it("an approver removes an entry by typing the whole address; a wrong one removes nothing; a person's own stays", async () => {
    const user = await open();
    const rows = within(screen.getByRole("list", { name: "Opt-outs" })).getAllByRole("listitem");
    // The person's own unsubscribe has no Remove.
    expect(within(rows[1]).queryByRole("button", { name: /Remove/ })).toBeNull();
    await user.click(within(rows[0]).getByRole("button", { name: /Remove \+14…00/ }));
    const form = screen.getByRole("form", { name: /be messaged again/ });
    expect(form.textContent).toContain("Your workspace keeps a record of who did it");
    await user.type(within(form).getByLabelText("Whole phone number or email"), "+14155550999");
    await user.click(within(form).getByRole("button", { name: "Let them be messaged again" }));
    expect((await within(form).findByRole("alert")).textContent).toContain("doesn't match this entry");
    await user.clear(within(form).getByLabelText("Whole phone number or email"));
    await user.type(within(form).getByLabelText("Whole phone number or email"), "+14155550100");
    await user.click(within(form).getByRole("button", { name: "Let them be messaged again" }));
    expect(await screen.findByText(/can be messaged again on text messages/)).toBeTruthy();
    await waitFor(() => expect(within(screen.getByRole("list", { name: "Opt-outs" })).getAllByRole("listitem")).toHaveLength(2));
    expect(consent(fakeState()).entries.some((e) => e.address === "+14155550100")).toBe(false);
  });

  it("a member who can't approve sees the list but no Remove, and is told why", async () => {
    await open("mbr_viewer");
    expect(screen.queryAllByRole("button", { name: /Remove/ })).toHaveLength(0);
    expect(screen.getByText(/Only an approver can let someone be messaged again/)).toBeTruthy();
  });
});

describe("ConsentBadge and UnsubscribePage", () => {
  it("the badge says OK to message or opted out", async () => {
    vi.stubGlobal("fetch", appFetch("mbr_owner"));
    render(<><ConsentBadge address="+14155550100" channel="sms" /><ConsentBadge address="+14155550100" channel="voice" /></>);
    expect(await screen.findByText("Opted out of text messages")).toBeTruthy();
    expect(await screen.findByText("OK to message")).toBeTruthy();
  });

  it("the public stop page unsubscribes without signing in and says done the same way for any address", async () => {
    vi.stubGlobal("fetch", appFetch());
    const user = userEvent.setup();
    render(<UnsubscribePage />);
    await user.type(screen.getByLabelText("Your phone number or email"), "pat@example.com");
    await user.selectOptions(screen.getByLabelText("Stop"), "email");
    await user.click(screen.getByRole("button", { name: "Unsubscribe" }));
    expect((await screen.findByRole("status")).textContent).toContain("You won't hear from us on that email again.");
    expect(document.body.textContent).not.toMatch(/already|opt_/);
  });

  it("the stop page shows the API's message for an address it can't read", async () => {
    vi.stubGlobal("fetch", appFetch());
    const user = userEvent.setup();
    render(<UnsubscribePage />);
    await user.type(screen.getByLabelText("Your phone number or email"), "hello");
    await user.click(screen.getByRole("button", { name: "Unsubscribe" }));
    expect((await screen.findByRole("alert")).textContent).toContain("address must be a phone number with its country code");
  });
});
