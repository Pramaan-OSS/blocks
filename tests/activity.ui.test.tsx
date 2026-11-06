// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActivityLog } from "@/components/pramaan/activity/activity-log";
import { failNext, resetFake } from "@/lib/pramaan/fake";
import { appFetch } from "./harness";

beforeEach(() => resetFake());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const NOT_FOUND = { code: "not_found", message: "No such route." };

async function open() {
  vi.stubGlobal("fetch", appFetch());
  const user = userEvent.setup();
  render(<ActivityLog />);
  return user;
}

describe("ActivityLog", () => {
  it("lists what ran in words, with cost and status, and no ids", async () => {
    await open();
    const list = await screen.findByRole("list", { name: "Calls" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(20);
    expect(list.textContent).toMatch(/Search the web|Send an email|Write with AI/);
    expect(list.textContent).toMatch(/\d{1,2} [A-Z][a-z]{2}, \d{1,2}:\d\d (AM|PM)/);
    expect(list.textContent).not.toMatch(/\$|call_fake/);
    for (const pill of ["Done", "Failed"]) expect(within(list).getAllByText(pill).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/call_fake|email\.send|web\.search/);
  });

  it("Show more adds the next page", async () => {
    const user = await open();
    await screen.findByRole("list", { name: "Calls" });
    await user.click(screen.getByRole("button", { name: "Show more" }));
    await waitFor(() => expect(within(screen.getByRole("list", { name: "Calls" })).getAllByRole("listitem")).toHaveLength(40));
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });

  it("filters to failed calls, and a failed call says what went wrong and what to do next", async () => {
    const user = await open();
    await screen.findByRole("list", { name: "Calls" });
    await user.selectOptions(screen.getByLabelText("What ran"), "Send an email");
    await user.selectOptions(screen.getByLabelText("How it went"), "Failed");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(within(screen.getByRole("list", { name: "Calls" })).getAllByRole("listitem").length).toBeLessThan(10));
    const rows = within(screen.getByRole("list", { name: "Calls" })).getAllByRole("listitem");
    for (const r of rows) expect(r.textContent).toContain("Failed");
    await user.click(within(rows[0]).getByRole("button"));
    const detail = await screen.findByRole("region", { name: "Call details" });
    expect(await within(detail).findByRole("alert")).toBeTruthy();
    expect(detail.textContent).toContain("This call failed.");
    expect(detail.textContent).toContain("What to do next: Check your app settings before trying again.");
    expect(detail.textContent).not.toMatch(/\$/);
    expect(within(detail).getByRole("button", { name: "Copy reference" })).toBeTruthy();
    expect(detail.textContent).not.toMatch(/call_fake|connection_required/);
  });

  it("says nothing ran in a period with no calls", async () => {
    const user = await open();
    await screen.findByRole("list", { name: "Calls" });
    await user.type(screen.getByLabelText("From"), "2001-01-01");
    await user.type(screen.getByLabelText("To"), "2001-01-02");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(await screen.findByText("Nothing ran in this period")).toBeTruthy();
  });

  it("shows an error without daily totals when calls cannot be read", async () => {
    failNext("GET", "/v1/calls", 404, NOT_FOUND);
    await open();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("table", { name: "Daily totals" })).toBeNull();
  });

  it("always offers delivery history and lets a person replay a saved delivery", async () => {
    const user = await open();
    await user.click(screen.getByRole("tab", { name: "Webhook deliveries" }));
    const list = await screen.findByRole("list", { name: "Webhook deliveries" });
    expect(list.textContent).toContain("Job finished");
    await user.click(within(list).getAllByRole("button", { name: "Replay" })[0]);
    expect(await screen.findByText("Replay queued.")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/whd_fake|job\.finished/);
    cleanup();
    failNext("GET", "/v1/webhook-deliveries", 404, NOT_FOUND);
    const again = await open();
    await again.click(screen.getByRole("tab", { name: "Webhook deliveries" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
  });

});
