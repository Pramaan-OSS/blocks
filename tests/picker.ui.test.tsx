// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SuperpowerPicker } from "@/components/pramaan/picker/superpower-picker";
import { fakeState, resetFake } from "@/lib/pramaan/fake";
import { appFetch } from "./harness";

beforeEach(() => resetFake());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function open() {
  vi.stubGlobal("fetch", appFetch("mbr_owner"));
  const user = userEvent.setup();
  render(<SuperpowerPicker approvalsHref="/inbox" missionsHref="/go-missions" />);
  await screen.findByRole("list", { name: "Matches" });
  return user;
}

const search = async (user: ReturnType<typeof userEvent.setup>, words: string) => {
  await user.clear(screen.getByLabelText("What do you want to do?"));
  await user.type(screen.getByLabelText("What do you want to do?"), words);
  await user.click(screen.getByRole("button", { name: "Search" }));
};

describe("SuperpowerPicker", () => {
  it("lists matches by plain name with a price, and no ids", async () => {
    const user = await open();
    await search(user, "web");
    await waitFor(() => expect(within(screen.getByRole("list", { name: "Matches" })).getAllByRole("listitem")).toHaveLength(2));
    const list = screen.getByRole("list", { name: "Matches" });
    expect(list.textContent).toContain("Search the web");
    expect(list.textContent).not.toMatch(/\$/);
    expect(document.body.textContent).not.toMatch(/web\.search|sms\.send|email\.send/);
  });

  it("runs a read-only action from a form built from its inputs and shows the result as lines", async () => {
    const user = await open();
    await search(user, "web");
    await user.click(await screen.findByRole("button", { name: /Search the web/ }));
    await user.type(await screen.findByLabelText(/Search for/), "pramaan");
    await user.click(screen.getByRole("button", { name: "Check before running" }));
    await screen.findByLabelText("Readiness");
    await user.click(screen.getByRole("button", { name: "Run it" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByLabelText("Exact inputs").textContent).toContain("pramaan");
    await user.dblClick(within(dialog).getByRole("button", { name: "Run it" }));
    const result = await screen.findByLabelText("What came back");
    expect(result.textContent).toContain("Results for pramaan");
    expect(result.textContent).not.toMatch(/[{}\[\]]|"title"/);
    expect(fakeState().requests.filter((r) => r.method === "POST" && r.path.endsWith("/web.search"))).toHaveLength(1);
  });

  it("asks its clarify question, and an action that sends waits in the approvals inbox", async () => {
    const user = await open();
    await search(user, "send");
    const q = await screen.findByRole("region", { name: "A quick question" });
    expect(q.textContent).toContain("Do you want to send an email or a text message?");
    await user.click(within(q).getByRole("button", { name: "Send a text message" }));
    await user.type(await screen.findByLabelText(/^To/), "+15555550123");
    await user.type(screen.getByLabelText(/Message|Text/), "Your table is ready.");
    await user.click(screen.getByRole("button", { name: "Check before running" }));
    await screen.findByLabelText("Readiness");
    await user.click(screen.getByRole("button", { name: "Ask for a yes" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("goes to the approvals inbox first");
    await user.click(within(dialog).getByRole("button", { name: "Ask for a yes" }));
    const note = await screen.findByText(/Waiting for a yes/);
    expect(within(note.parentElement!).getByRole("link", { name: "Open the approvals inbox" }).getAttribute("href")).toBe("/inbox");
    expect([...fakeState().approvals.values()].filter((a) => a.capability === "sms.send" && JSON.stringify(a.input).includes("+15555550123"))).toHaveLength(1);
  });

  it("a missing field is stopped on the form, before any price or run", async () => {
    const user = await open();
    await search(user, "web");
    await user.click(await screen.findByRole("button", { name: /Search the web/ }));
    await user.click(await screen.findByRole("button", { name: "Check before running" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Search for is required.");
    expect(screen.queryByLabelText("Readiness")).toBeNull();
  });

  it("a mission shows its steps and leads to the missions screen", async () => {
    const user = await open();
    await search(user, "research company");
    await user.click(await screen.findByRole("button", { name: /Research a company/ }));
    const steps = await screen.findByRole("list", { name: "Steps" });
    expect(within(steps).getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getByRole("link", { name: "Run it in Missions" }).getAttribute("href")).toBe("/go-missions");
  });

  it("says when nothing matches, with the words that missed", async () => {
    const user = await open();
    await search(user, "quuxglorp");
    expect(await screen.findByText(/Nothing fits “quuxglorp”/)).toBeTruthy();
  });
});
