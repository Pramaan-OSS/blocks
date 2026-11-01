// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlanCard } from "@/components/pramaan/subscriptions/plan-card";
import { failNext, fakeState, resetFake } from "@/lib/pramaan/fake";
import { laneCState } from "@/lib/pramaan/fake-wave3";
import { appFetch } from "./harness";

beforeEach(() => {
  resetFake();
  vi.stubGlobal("fetch", appFetch());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const sub = () => laneCState(fakeState()).subs.get("sub_FAKE0001")!;

describe("PlanCard", () => {
  it("shows the price, the status and the renewal date, with no ids or raw words", async () => {
    render(<PlanCard />);
    expect(await screen.findByText("$29.00 a month")).toBeTruthy();
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText(/^Renews on \d{1,2} \w{3}/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/sub_|cus_|past_due|usd/);
  });

  it("Manage billing opens the billing page once, even on a double click", async () => {
    const go = vi.fn();
    render(<PlanCard onRedirect={go} />);
    await userEvent.dblClick(await screen.findByRole("button", { name: "Manage billing" }));
    await waitFor(() => expect(go).toHaveBeenCalledTimes(1));
    expect(go.mock.calls[0][0]).toContain("/subscriptions/stand-in");
    expect(fakeState().requests.filter((r) => r.path.endsWith("billing.portal.create"))).toHaveLength(1);
  });

  it("a plan that stops at the end of the period says when and that nothing more is charged", async () => {
    sub().cancelAtPeriodEnd = true;
    render(<PlanCard />);
    expect(await screen.findByText("Ending")).toBeTruthy();
    expect(screen.getByText(/^Ends on .*You won't be charged again\.$/)).toBeTruthy();
  });

  it("an overdue payment says what to do", async () => {
    sub().status = "past_due";
    render(<PlanCard />);
    expect(await screen.findByText("Payment overdue")).toBeTruthy();
    expect(screen.getByText(/Update your payment method/)).toBeTruthy();
  });

  it("no plan: says so and offers to see the plans", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => appFetch()(url, { ...init, headers: { cookie: "pramaan_customer=cus_FAKE0099" } })));
    render(<PlanCard emptyHref="/plans" />);
    expect(await screen.findByText("No plan yet")).toBeTruthy();
    expect(screen.getByRole("link", { name: "See the plans" }).getAttribute("href")).toBe("/plans");
  });

  it("shows the API's message when the billing page can't be made, and Manage billing works again", async () => {
    failNext("POST", "/v1/capabilities/billing.portal.create", 404, { code: "not_found", message: "Customer not found in your billing account." });
    render(<PlanCard onRedirect={vi.fn()} />);
    await userEvent.click(await screen.findByRole("button", { name: "Manage billing" }));
    expect(await screen.findByText("Customer not found in your billing account.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Manage billing" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("a plan list that fails shows the message with Try again", async () => {
    failNext("POST", "/v1/capabilities/billing.subscriptions.list", 502, { code: "upstream_unavailable", message: "Billing is busy. Try again." });
    render(<PlanCard />);
    expect(await screen.findByText("Billing is busy. Try again.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});
