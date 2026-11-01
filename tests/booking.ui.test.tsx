// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BookingPicker } from "@/components/pramaan/booking/booking-picker";
import { decideElsewhere, fakeState, resetFake } from "@/lib/pramaan/fake";
import { platform } from "@/lib/pramaan/fake-platform";
import { appFetch, useClock } from "./harness";

beforeEach(() => {
  resetFake();
  useClock(fakeState(), 1_000);
  vi.stubGlobal("fetch", appFetch());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const connect = () => void (platform(fakeState()).connections.get("user-42")!.find((x) => x.app === "googlecalendar")!.status = "active");

async function fillAndBook(name = "Sam Lee", email = "sam@example.com") {
  const times = within(await screen.findByRole("group", { name: "Time" }));
  await userEvent.click(times.getAllByRole("button")[0]);
  await userEvent.type(await screen.findByLabelText("Your name"), name);
  await userEvent.type(screen.getByLabelText("Your email"), email);
  await userEvent.click(screen.getByRole("button", { name: "Book this time" }));
}

describe("BookingPicker", () => {
  it("says the calendar needs connecting and links to connections", async () => {
    render(<BookingPicker />);
    expect(await screen.findByText("The calendar needs to be connected again.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to connections" }).getAttribute("href")).toBe("/connections");
    expect(screen.queryByRole("group", { name: "Time" })).toBeNull();
  });

  it("shows open times, sends the request, and says it is waiting for a yes", async () => {
    connect();
    render(<BookingPicker />);
    await fillAndBook();
    expect(await screen.findByText("Request sent")).toBeTruthy();
    expect(screen.getByText(/waiting for a yes/)).toBeTruthy();
    expect(screen.getByText(/You'll get an invitation by email once it's confirmed/)).toBeTruthy();
    expect(screen.getByText(/If you don't hear back, the time wasn't confirmed/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/ref_|googlecalendar|busy/);
  });

  it("sends the neutral bot-check callback's token with the booking", async () => {
    connect();
    const getBotCheckToken = vi.fn().mockResolvedValue("test-token");
    render(<BookingPicker getBotCheckToken={getBotCheckToken} />);
    await fillAndBook();
    await screen.findByText("Request sent");
    expect(getBotCheckToken).toHaveBeenCalledTimes(1);
    const submitted = vi.mocked(fetch).mock.calls.find(([url, init]) => url === "/api/pramaan/booking" && init?.method === "POST");
    expect(JSON.parse(submitted![1]!.body as string)).toMatchObject({ botCheckToken: "test-token" });
  });

  it("once approved the time is gone from the list", async () => {
    connect();
    const { unmount } = render(<BookingPicker />);
    const first = (await screen.findAllByRole("button", { name: /\d:\d\d (AM|PM)/ }))[0].textContent;
    await fillAndBook();
    await screen.findByText("Request sent");
    act(() => decideElsewhere([...fakeState().approvals.keys()].at(-1)!, "approved"));
    unmount();
    render(<BookingPicker />);
    const after = (await screen.findAllByRole("button", { name: /\d:\d\d (AM|PM)/ })).map((b) => b.textContent);
    expect(after[0]).not.toBe(first);
  });

  it("shows the server's words for a bad email and keeps the form", async () => {
    connect();
    render(<BookingPicker />);
    await fillAndBook("Sam", "nope");
    expect(await screen.findByText("That email address doesn't look right.")).toBeTruthy();
    expect((screen.getByLabelText("Your name") as HTMLInputElement).value).toBe("Sam");
  });
});
