// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssessmentHub } from "@/components/pramaan/assessment/assessment-hub";
import { MissionRunner } from "@/components/pramaan/missions/mission-runner";
import { Wallet } from "@/components/pramaan/wallet/wallet-panel";
import { actionName, formatDate, formatDay, humanize, requesterLabel } from "@/lib/pramaan/plain";
import { fakeState, resetFake } from "@/lib/pramaan/fake";
import { appFetch, useClock } from "./harness";

beforeEach(() => {
  resetFake();
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("plain helpers", () => {
  it("names actions, people and dates in words", () => {
    expect(actionName("company.research")).toBe("Research a company");
    expect(actionName("assessment.invitations.list")).toBe("List assessment invitations");
    expect(actionName("widget")).toBe("Widget");
    expect(requesterLabel({ kind: "key", member_id: "mbr_viewer" })).toBe("A team member");
    expect(humanize("integrity_score")).toBe("Integrity score");
    expect(humanize("accountName")).toBe("Account name");
    expect(formatDate(new Date(2020, 9, 31, 20, 3))).toBe("31 Oct 2020, 8:03 PM");
    expect(formatDate(new Date(2020, 9, 31, 0, 5), { time: false })).toBe("31 Oct 2020");
    expect(formatDay("2020-10-03")).toBe("3 Oct 2020");
  });
});

describe("plain wording on screen", () => {
  it("the usage chart labels each bar with its day and gives every bar a keyboard stop with its amount", async () => {
    vi.stubGlobal("fetch", appFetch());
    render(<Wallet />);
    const bars = await screen.findByRole("list", { name: "Spend by day" });
    const items = [...bars.children] as HTMLElement[];
    expect(items).toHaveLength(7);
    for (const li of items) {
      expect(li.tabIndex).toBe(0);
      expect(li.textContent).toMatch(/\d{1,2} [A-Z][a-z]{2}.*\$\d+\.\d\d/);
    }
    expect(items[0].querySelector("[aria-hidden]")?.textContent).toMatch(/^\d{1,2} [A-Z][a-z]{2}$/);
  });

  it("a mission is named in words, confirms with labelled fields, and shows its result as lines, not JSON", async () => {
    const time = useClock(fakeState());
    vi.stubGlobal("fetch", appFetch("mbr_owner"));
    const user = userEvent.setup();
    render(<MissionRunner pollMs={40} />);
    const picker = await screen.findByLabelText("Mission");
    expect(within(picker).getByRole("option", { name: /Research a company/ })).toBeTruthy();
    expect(picker.textContent).not.toContain("company.research");
    await user.selectOptions(picker, "company.research");
    await user.type(await screen.findByLabelText(/Domain/), "example.com");
    await user.click(screen.getByRole("button", { name: "Get estimate" }));
    await screen.findByLabelText("Estimate");
    await user.click(screen.getByRole("button", { name: "Start" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByRole("heading", { name: "Research a company?" })).toBeTruthy();
    const exact = within(dialog).getByLabelText("Exact inputs");
    expect(exact.textContent).toContain("Domain");
    expect(exact.textContent).not.toMatch(/[{}\"]|domain\b.*:/);
    await user.click(within(dialog).getByRole("button", { name: "Start" }));
    await screen.findByRole("list", { name: "Steps" });
    for (let i = 0; i < 6; i++) time.advance(1_000);
    const result = await screen.findByLabelText("What came back", undefined, { timeout: 3_000 });
    expect(result.textContent).toContain("Summary");
    expect(result.textContent).not.toMatch(/[{}]/);
  });

  it("the tracker names a candidate by number when this browser doesn't know their email, never by id", async () => {
    vi.stubGlobal("fetch", appFetch("mbr_owner"));
    const user = userEvent.setup();
    render(<AssessmentHub />);
    await user.click(await screen.findByRole("button", { name: /Backend engineer screen/ }));
    await user.click(screen.getByRole("tab", { name: "Candidates" }));
    const table = await screen.findByRole("table", { name: "Candidates" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(within(rows[0]).getByText("Candidate 1")).toBeTruthy();
    expect(within(rows[1]).getByText("Candidate 2")).toBeTruthy();
    expect(table.textContent).not.toMatch(/inv_[a-z0-9]+/);
    await user.click(within(rows[1]).getByRole("button", { name: "Details for Candidate 2" }));
    const detail = await screen.findByRole("region", { name: "Candidate details" });
    expect(within(detail).getByRole("heading", { name: "Candidate 2" })).toBeTruthy();
    expect(detail.textContent).not.toMatch(/inv_[a-z0-9]+/);
  });
});
