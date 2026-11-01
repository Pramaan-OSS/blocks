// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssessmentHub } from "@/components/pramaan/assessment/assessment-hub";
import { fakeState, resetFake } from "@/lib/pramaan/fake";
import { assessmentState } from "@/lib/pramaan/fake-assessment";
import { appFetch } from "./harness";

beforeEach(() => {
  resetFake();
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function open(title?: string) {
  const fetch = appFetch("mbr_owner");
  vi.stubGlobal("fetch", fetch);
  const user = userEvent.setup();
  render(<AssessmentHub approvalsHref="/inbox" />);
  if (title) await user.click(await screen.findByRole("button", { name: new RegExp(title) }));
  return { fetch, user };
}

const confirm = async (user: ReturnType<typeof userEvent.setup>, opener: HTMLElement, name: string) => {
  await user.click(opener);
  const dialog = await screen.findByRole("alertdialog");
  return { dialog, go: () => user.click(within(dialog).getByRole("button", { name })) };
};

describe("AssessmentHub", () => {
  it("builds an exam: draft, a question, preview, then publish after a confirm that says it can't be undone", async () => {
    const { user } = await open();
    await user.click(await screen.findByRole("button", { name: "New exam" }));
    await user.type(screen.getByLabelText(/Title/), "Sales aptitude");
    await user.click(screen.getByRole("button", { name: "Create draft" }));
    await screen.findByText("Draft", { selector: "h2 *" });

    // Nothing to publish yet.
    expect((screen.getByRole("button", { name: "Publish exam" }) as HTMLButtonElement).disabled).toBe(true);

    await user.type(screen.getByLabelText("Question *"), "Is 15% of 200 equal to 30?");
    await user.type(screen.getByLabelText("Option 1"), "Yes");
    await user.type(screen.getByLabelText("Option 2"), "No");
    await user.click(screen.getByLabelText("Option 1 is correct"));
    await user.click(screen.getByRole("button", { name: "Add question" }));
    const list = await screen.findByRole("list", { name: "Questions" });
    expect(list.textContent).toContain("1. Is 15% of 200 equal to 30?");
    expect(list.textContent).toContain("Correct");

    await user.click(screen.getByRole("button", { name: "Preview as a candidate" }));
    const preview = screen.getByRole("list", { name: "Candidate preview" });
    expect(preview.textContent).toContain("Is 15% of 200 equal to 30?");
    expect(preview.textContent).not.toContain("Correct");
    await user.click(screen.getByRole("button", { name: "Back to the author view" }));

    const { dialog, go } = await confirm(user, screen.getByRole("button", { name: "Publish exam" }), "Publish");
    expect(dialog.textContent).toContain("cannot be undone");
    await waitFor(() => expect(dialog.textContent).toContain("up to $0.01"));
    expect(within(dialog).getByLabelText("Exact details").textContent).toContain("Questions: 1");
    await go();
    await screen.findByText("Published. The questions are now frozen.");
    await screen.findByText("Published", { selector: "h2 *" });
    expect(screen.queryByRole("button", { name: "Add question" })).toBeNull();
  });

  it("says what is wrong with a question in the server's own words", async () => {
    const { user } = await open("Customer support quiz");
    await user.type(await screen.findByLabelText("Question *"), "Pick one.");
    await user.type(screen.getByLabelText("Option 1"), "A");
    await user.type(screen.getByLabelText("Option 2"), "B");
    await user.click(screen.getByRole("button", { name: "Add question" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Mark at least one option as correct.");
  });

  it("shows who is sent, started, finished and expired, and the counts", async () => {
    const { user } = await open("Backend engineer screen");
    await user.click(screen.getByRole("tab", { name: "Candidates" }));
    const table = await screen.findByRole("table", { name: "Candidates" });
    expect(screen.getByLabelText("Counts").textContent).toBe("Sent 1 · Started 1 · Finished 1 · Expired 1");
    const states = within(table).getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[1].textContent);
    expect(states).toEqual(["Sent", "Started", "Finished", "Expired"]);
  });

  it("creates links for many candidates after a confirm with the exact list and the most it costs", async () => {
    const { user } = await open("Backend engineer screen");
    await user.click(screen.getByRole("tab", { name: "Candidates" }));
    await user.type(await screen.findByLabelText(/Candidate emails/), "sam@example.com\nlee@example.com");
    await user.selectOptions(screen.getByLabelText("How to deliver"), "link");
    const { dialog, go } = await confirm(user, screen.getByRole("button", { name: "Create links" }), "Create links");
    expect(within(dialog).getByLabelText("Exact details").textContent).toContain("sam@example.com, lee@example.com");
    await waitFor(() => expect(dialog.textContent).toContain("up to $1.03"));
    await go();
    const made = await screen.findByRole("list", { name: "Invitations created" });
    expect((within(made).getByLabelText("Link for sam@example.com") as HTMLInputElement).value).toMatch(/^https:\/\/tests\.example\.com\/i\//);
    await waitFor(() => expect(screen.getByLabelText("Counts").textContent).toContain("Link created 2"));
    // The tracker names them from what this browser invited.
    expect(within(screen.getByRole("table", { name: "Candidates" })).getByText("sam@example.com")).toBeTruthy();
  });

  it("emails each candidate their own link; the email waits for a yes and points to the inbox", async () => {
    const { user } = await open("Backend engineer screen");
    await user.click(screen.getByRole("tab", { name: "Candidates" }));
    await user.type(await screen.findByLabelText(/Candidate emails/), "sam@example.com");
    const { dialog, go } = await confirm(user, screen.getByRole("button", { name: "Send invitations" }), "Send");
    expect(within(dialog).getByLabelText("Exact details").textContent).toContain("From: your connected Gmail or Outlook");
    await go();
    const made = await screen.findByRole("list", { name: "Invitations created" });
    expect(within(made).getByRole("link", { name: "Open the approvals inbox" }).getAttribute("href")).toBe("/inbox");
    expect(assessmentState(fakeState()).emails).toHaveLength(1);
  });

  it("never offers a Pramaan address: the refusal shows the server's message", async () => {
    const { user } = await open("Backend engineer screen");
    await user.click(screen.getByRole("tab", { name: "Candidates" }));
    await user.type(await screen.findByLabelText(/Candidate emails/), "sam@example.com");
    await user.selectOptions(screen.getByLabelText("How to deliver"), "domain");
    await user.type(screen.getByLabelText("From address"), "tests@mail.pramaan.dev");
    const { go } = await confirm(user, screen.getByRole("button", { name: "Send invitations" }), "Send");
    await go();
    expect((await screen.findByRole("alert")).textContent).toContain("never a Pramaan address");
    expect(assessmentState(fakeState()).emails).toHaveLength(0);
  });

  it("withdrawing an unused invitation goes to the approvals inbox; a started one has no Withdraw", async () => {
    const { user } = await open("Backend engineer screen");
    await user.click(screen.getByRole("tab", { name: "Candidates" }));
    const table = await screen.findByRole("table", { name: "Candidates" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).queryByRole("button", { name: "Withdraw" }) !== null)).toEqual([true, false, false, false]);
    const { dialog, go } = await confirm(user, within(rows[0]).getByRole("button", { name: "Withdraw" }), "Withdraw");
    expect(dialog.textContent).toContain("credit held for them is released");
    await go();
    expect(await screen.findByText(/Withdrawal sent for approval/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open the approvals inbox" }).getAttribute("href")).toBe("/inbox");
  });

  it("shows the result and the integrity report of a finished candidate", async () => {
    const { user } = await open("Backend engineer screen");
    await user.click(screen.getByRole("tab", { name: "Candidates" }));
    const rows = within(await screen.findByRole("table", { name: "Candidates" })).getAllByRole("row").slice(1);
    await user.click(within(rows[2]).getByRole("button", { name: /Details/ }));
    const result = await screen.findByLabelText("Result");
    await waitFor(() => expect(result.textContent).toContain("82"));
    expect(result.textContent).toContain("Passed");
    expect(within(result).getByRole("table", { name: "Grades by question" })).toBeTruthy();
    const integrity = await screen.findByLabelText("Integrity");
    await waitFor(() => expect(integrity.textContent).toContain("Clean"));
    expect(within(integrity).getByRole("table", { name: "Evidence counts" }).textContent).toContain("Tab switch");
  });

  it("a result that isn't ready is pending with a retry, not an error", async () => {
    const { user } = await open("Backend engineer screen");
    assessmentState(fakeState()).invites.get("inv_alan")!.ready = false;
    await user.click(screen.getByRole("tab", { name: "Candidates" }));
    const rows = within(await screen.findByRole("table", { name: "Candidates" })).getAllByRole("row").slice(1);
    await user.click(within(rows[2]).getByRole("button", { name: /Details/ }));
    const result = await screen.findByLabelText("Result");
    await waitFor(() => expect(result.textContent).toContain("Pending."));
    expect(result.textContent).toContain("Not ready yet. Grading is still running; try again in a minute.");
    expect(within(result).queryByRole("alert")).toBeNull();
    assessmentState(fakeState()).invites.get("inv_alan")!.ready = true;
    await user.click(within(result).getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(result.textContent).toContain("82"));
  });

  it("explains that a started candidate has no result yet", async () => {
    const { user } = await open("Backend engineer screen");
    await user.click(screen.getByRole("tab", { name: "Candidates" }));
    const rows = within(await screen.findByRole("table", { name: "Candidates" })).getAllByRole("row").slice(1);
    await user.click(within(rows[1]).getByRole("button", { name: /Details/ }));
    const result = await screen.findByLabelText("Result");
    expect(result.textContent).toContain("once the candidate finishes");
  });
});
