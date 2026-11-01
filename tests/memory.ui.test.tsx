// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryViewer } from "@/components/pramaan/memory/memory-viewer";
import { fakeState, resetFake } from "@/lib/pramaan/fake";
import { memory } from "@/lib/pramaan/fake-memory";
import { appFetch } from "./harness";

beforeEach(() => resetFake());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function open(member = "mbr_owner") {
  vi.stubGlobal("fetch", appFetch(member));
  const user = userEvent.setup();
  render(<MemoryViewer approvalsHref="/inbox" />);
  return user;
}

describe("MemoryViewer", () => {
  it("lists what is remembered in words, with no ids, and searches", async () => {
    const user = await open();
    const list = await screen.findByRole("list", { name: "Memories" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(5);
    expect(list.textContent).toContain("Is vegetarian and allergic to peanuts.");
    expect(list.textContent).toMatch(/Remembered \d{1,2} [A-Z][a-z]{2}/);
    expect(document.body.textContent).not.toMatch(/rh_mem|user-42|ref_/);
    expect(document.body.textContent).not.toContain("Another person's");
    await user.type(screen.getByLabelText("Search what is remembered"), "lisbon");
    await user.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(within(screen.getByRole("list", { name: "Memories" })).getAllByRole("listitem")).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: "Show all" }));
    await waitFor(() => expect(within(screen.getByRole("list", { name: "Memories" })).getAllByRole("listitem")).toHaveLength(5));
  });

  it("deleting one asks first, shows the exact memory, and then waits for approval in the inbox", async () => {
    const user = await open();
    const rows = within(await screen.findByRole("list", { name: "Memories" })).getAllByRole("listitem");
    await user.click(within(rows[0]).getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByLabelText("Memory to delete").textContent).toBe("Is planning a trip to Lisbon in March.");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await screen.findByText(/Deleting this memory was sent for approval/);
    expect(screen.getByRole("link", { name: "Open the approvals inbox" }).getAttribute("href")).toBe("/inbox");
    expect(within(rows[0]).getByText("Waiting for approval")).toBeTruthy();
    expect(within(rows[0]).queryByRole("button", { name: "Delete" })).toBeNull();
  });

  it("an empty list says memories come from chats, and that deleting a chat deletes them", async () => {
    memory(fakeState()).items.length = 0;
    await open();
    expect((await screen.findByText("Nothing is remembered yet")).parentElement?.textContent).toContain("Deleting a chat also deletes the memories that came from it.");
    expect(screen.queryByRole("button", { name: "Forget everything" })).toBeNull();
  });

  it("forget everything asks first and then waits for approval", async () => {
    const user = await open();
    await screen.findByRole("list", { name: "Memories" });
    await user.click(screen.getByRole("button", { name: "Forget everything" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Forget everything" }));
    expect(await screen.findByText(/Forgetting everything was sent for approval/)).toBeTruthy();
  });

  it("changes tab says what was remembered, in words", async () => {
    const user = await open();
    await user.click(screen.getByRole("tab", { name: "Recent changes" }));
    const list = await screen.findByRole("list", { name: "Recent changes" });
    expect(within(list).getAllByText("Remembered")).toHaveLength(5);
    expect(list.textContent).not.toMatch(/rh_mem/);
  });

  it("an admin reviews organisation memories; a member is told only admins can", async () => {
    const user = await open();
    await user.click(screen.getByRole("tab", { name: "Organisation" }));
    const review = await screen.findByRole("region", { name: "Waiting for review" });
    expect(within(review).getByText("Check first")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/mi_org/);
    await user.click(within(review).getByRole("button", { name: /Reject: Invoices/ }));
    await screen.findByText("Rejected. It won't be shared.");
    await waitFor(() => expect(within(screen.getByRole("region", { name: "Waiting for review" })).queryByText(/Invoices are sent/)).toBeNull());
    const auto = screen.getByRole("region", { name: "Added automatically" });
    await user.click(within(auto).getByRole("button", { name: /Got it/ }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Added automatically" })).toBeNull());
    cleanup();
    const member = await open("mbr_viewer");
    await member.click(screen.getByRole("tab", { name: "Organisation" }));
    expect(await screen.findByText("Only admins review these")).toBeTruthy();
  });
});
