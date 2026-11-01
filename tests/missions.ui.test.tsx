// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MissionRunner } from "@/components/pramaan/missions/mission-runner";
import { fakeState, resetFake } from "@/lib/pramaan/fake";
import { platform } from "@/lib/pramaan/fake-platform";
import { appFetch, useClock } from "./harness";

let time: ReturnType<typeof useClock>;
beforeEach(() => {
  resetFake();
  localStorage.clear();
  time = useClock(fakeState());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const runCalls = (fetch: ReturnType<typeof appFetch>) => fetch.mock.calls.filter(([url]) => String(url).endsWith("/run"));

async function estimated(domain = "example.com") {
  const fetch = appFetch("mbr_owner");
  vi.stubGlobal("fetch", fetch);
  const user = userEvent.setup();
  const view = render(<MissionRunner missionId="company.research" pollMs={40} />);
  await user.type(await screen.findByLabelText(/Domain/), domain);
  await user.click(screen.getByRole("button", { name: "Get estimate" }));
  await screen.findByLabelText("Estimate");
  return { fetch, user, view };
}

async function startRun(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Start" }));
  const dialog = await screen.findByRole("alertdialog");
  expect(within(dialog).getByLabelText("Exact inputs").textContent).toContain("example.com");
  await user.click(within(dialog).getByRole("button", { name: "Start" }));
  await screen.findByRole("list", { name: "Steps" });
}

describe("MissionRunner", () => {
  it("builds the start form from the input schema and shows the estimate before it starts", async () => {
    await estimated();
    const est = screen.getByLabelText("Estimate");
    expect(est.textContent).toContain("at most $0.21");
    expect(est.textContent).toContain("Collect recent news");
    expect(screen.getByRole("button", { name: "Start" })).toBeTruthy();
    // Nothing ran yet.
    expect(platform(fakeState()).jobs.size).toBe(0);
  });

  it("says what is missing and keeps Start off when the estimate is not ready", async () => {
    const fetch = appFetch("mbr_owner");
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    render(<MissionRunner missionId="company.research" pollMs={40} />);
    await user.click(await screen.findByRole("button", { name: "Get estimate" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Send a domain or a name for the company.");
    expect((screen.getByRole("button", { name: "Start" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("checks required fields before asking for an estimate", async () => {
    const fetch = appFetch("mbr_owner");
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    render(<MissionRunner missionId="broadcast.send" pollMs={40} />);
    await user.click(await screen.findByRole("button", { name: "Get estimate" }));
    expect(await screen.findByText("Account is required.")).toBeTruthy();
    expect(screen.getByText("Name is required.")).toBeTruthy();
    expect(fetch.mock.calls.some(([url]) => String(url).endsWith("/estimate"))).toBe(false);
  });

  it("shows each step as it runs, then the result and the cost", async () => {
    const { user } = await estimated();
    await startRun(user);
    const steps = screen.getByRole("list", { name: "Steps" });
    expect(within(steps).getAllByRole("listitem").map((li) => li.getAttribute("data-status"))).toEqual(["running", "waiting", "waiting", "waiting"]);
    time.advance(2_500);
    await waitFor(() => expect(within(steps).getAllByRole("listitem").map((li) => li.getAttribute("data-status"))).toEqual(["done", "done", "running", "waiting"]));
    expect(screen.getByText("$0.07")).toBeTruthy();
    time.advance(5_000);
    await screen.findByLabelText("Result");
    expect(screen.getByLabelText("Result").textContent).toContain("A sourced profile of example.com.");
    expect(screen.getByText("$0.21")).toBeTruthy();
  });

  it("survives a page reload: it reattaches to the same run and does not start another", async () => {
    const { fetch, user, view } = await estimated();
    await startRun(user);
    time.advance(1_500);
    view.unmount();
    render(<MissionRunner missionId="company.research" pollMs={40} />);
    const steps = await screen.findByRole("list", { name: "Steps" });
    await waitFor(() => expect(within(steps).getAllByRole("listitem")[0].getAttribute("data-status")).toBe("done"));
    expect(runCalls(fetch)).toHaveLength(1);
    expect(platform(fakeState()).jobs.size).toBe(1);
  });

  it("cancels cleanly: pays only for work done and says so", async () => {
    const { user } = await estimated();
    await startRun(user);
    time.advance(1_500);
    await user.click(screen.getByRole("button", { name: "Cancel run" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("You pay only for the work already done, never more than the estimate");
    await user.click(within(dialog).getByRole("button", { name: "Cancel run" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Cancelled. You were charged $0.02 for the work already done."));
    expect(screen.queryByRole("button", { name: "Cancel run" })).toBeNull();
    expect(fakeState().holds.size).toBe(0);
    const items = within(screen.getByRole("list", { name: "Steps" })).getAllByRole("listitem");
    expect(items.map((li) => li.getAttribute("data-status"))).toEqual(["done", "skipped", "skipped", "skipped"]);
  });

  it("a step that needs a yes points to the approvals inbox", async () => {
    const fetch = appFetch("mbr_owner");
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    render(<MissionRunner missionId="broadcast.send" approvalsHref="/inbox" pollMs={40} />);
    await user.type(await screen.findByLabelText(/Account/), "acc_sms1");
    await user.type(screen.getByLabelText(/^Name/), "Launch");
    await user.type(screen.getByLabelText(/^Message/), "We launched.");
    await user.click(screen.getByRole("button", { name: "Get estimate" }));
    const est = await screen.findByLabelText("Estimate");
    expect(est.textContent).toContain("needs a person’s approval");
    await user.click(screen.getByRole("button", { name: "Start" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Start" }));
    await screen.findByRole("list", { name: "Steps" });
    time.advance(5_000);
    const note = await screen.findByRole("note");
    expect(within(note).getByRole("link").getAttribute("href")).toBe("/inbox");
  });

  it("shows the server's own message when the start is refused for low credit, with where to add it", async () => {
    platform(fakeState()).balanceMicro = 50_000;
    const fetch = appFetch("mbr_owner");
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    render(<MissionRunner missionId="company.research" pollMs={40} />);
    await user.type(await screen.findByLabelText(/Domain/), "example.com");
    await user.click(screen.getByRole("button", { name: "Get estimate" }));
    const est = await screen.findByLabelText("Estimate");
    expect(within(est).getByRole("link", { name: "Add credit" }).getAttribute("href")).toContain("/settings/wallet");
    expect((screen.getByRole("button", { name: "Start" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
