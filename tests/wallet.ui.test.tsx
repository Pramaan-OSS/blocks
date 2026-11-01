// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorState } from "@/components/pramaan/states";
import { CustomerCreditsCard, Wallet, WalletCard } from "@/components/pramaan/wallet/wallet-panel";
import { ApiError } from "@/lib/pramaan/client";
import { actionName } from "@/lib/pramaan/plain";
import { fakeState, resetFake } from "@/lib/pramaan/fake";
import { platform } from "@/lib/pramaan/fake-platform";
import { appFetch } from "./harness";

beforeEach(() => {
  resetFake();
  vi.stubGlobal("fetch", appFetch());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.pushState({}, "", "/");
});

describe("Wallet", () => {
  it("shows the balance in dollars to 2 decimals, what is set aside, and a top-up link", async () => {
    platform(fakeState()).balanceMicro = 905_219 + 500_000;
    fakeState().holds.set("job:x", 500_000);
    render(<WalletCard />);
    const card = await screen.findByLabelText("Balance");
    expect(within(card).getByLabelText("Balance $0.91")).toBeTruthy();
    expect(card.textContent).not.toContain("905219");
    expect(within(card).getByText("$0.50")).toBeTruthy();
    const link = within(card).getByRole("link", { name: /Add credit/ });
    expect(link.getAttribute("href")).toBe("https://app.pramaan.dev/settings/wallet");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("warns when the balance is low or empty, and not otherwise", async () => {
    render(<WalletCard />);
    await screen.findByLabelText("Balance");
    expect(screen.queryByRole("alert")).toBeNull();
    cleanup();
    platform(fakeState()).balanceMicro = 3_000_000;
    render(<WalletCard />);
    expect((await screen.findByRole("alert")).textContent).toContain("Your balance is low ($3.00). Add credit before your next run.");
    cleanup();
    platform(fakeState()).balanceMicro = 0;
    render(<WalletCard />);
    expect((await screen.findByRole("alert")).textContent).toContain("Your balance is empty.");
  });

  it("shows usage over time and by superpower, from the API's rows", async () => {
    render(<Wallet />);
    const usage = await screen.findByLabelText("Usage");
    const byCap = await within(usage).findByRole("table", { name: "Spend by action" });
    const seven = platform(fakeState()).usage.filter((r) => r.day >= new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10));
    const expected = new Map<string, number>();
    for (const r of seven) expected.set(r.capability, (expected.get(r.capability) ?? 0) + r.spend_micro);
    const rows = within(byCap).getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell").map((c) => c.textContent));
    // Biggest spender first, each cost in dollars.
    const ordered = [...expected].sort((a, b) => b[1] - a[1]);
    expect(rows.map((r) => r[0])).toEqual(ordered.map(([id]) => actionName(id)));
    expect(rows.map((r) => r[2])).toEqual(ordered.map(([, v]) => `$${(v / 1e6).toFixed(2)}`));
    expect(within(usage).getByRole("list", { name: "Spend by day" }).children).toHaveLength(7);
    expect(within(usage).getByRole("table", { name: "Latest activity" })).toBeTruthy();
  });

  it("switches the range to 30 days", async () => {
    const user = userEvent.setup();
    render(<Wallet />);
    const usage = await screen.findByLabelText("Usage");
    await within(usage).findByRole("list", { name: "Spend by day" });
    await user.click(within(usage).getByRole("button", { name: "Last 30 days" }));
    await waitFor(() => expect(within(usage).getByRole("list", { name: "Spend by day" }).children).toHaveLength(30));
  });

  it("shows an empty state when nothing ran", async () => {
    platform(fakeState()).usage = [];
    render(<Wallet />);
    expect(await screen.findByText("No usage in this period")).toBeTruthy();
  });

  it("a refusal for low credit links to the wallet, which points at the top-up button", async () => {
    const refusal = new ApiError("Your balance is too low for this run. Add credit, then try again.", "spend_cap_reached", undefined, 402, {
      message: "Add credit",
      links: [{ label: "Add credit", url: "https://app.pramaan.dev/settings/wallet" }],
      balance_micro: 50_000,
    });
    render(<ErrorState error={refusal} walletHref="/wallet?topup=1" />);
    expect(screen.getByRole("link", { name: "Add credit" }).getAttribute("href")).toBe("/wallet?topup=1");
    cleanup();

    window.history.pushState({}, "", "/wallet?topup=1");
    render(<WalletCard />);
    expect(await screen.findByText(/needs more credit than you have/)).toBeTruthy();
    await waitFor(() => expect(document.activeElement?.getAttribute("href")).toBe("https://app.pramaan.dev/settings/wallet"));
  });

  it("shows a customer's credit in dollars, and the API's message for an unknown customer", async () => {
    render(<CustomerCreditsCard customerId="cus_example" />);
    expect((await screen.findByRole("list", { name: "Customer credit" })).textContent).toContain("$19.99");
    cleanup();
    render(<CustomerCreditsCard customerId="cus_nope" />);
    expect((await screen.findByRole("alert")).textContent).toContain("No customer with that id.");
  });

  it("says Pramaan needs connecting when there is no key", async () => {
    process.env.PRAMAAN_FAKE = "";
    const key = process.env.PRAMAAN_API_KEY;
    delete process.env.PRAMAAN_API_KEY;
    try {
      render(<WalletCard />);
      expect((await screen.findByRole("alert")).textContent).toContain("Pramaan isn't connected yet.");
    } finally {
      process.env.PRAMAAN_FAKE = "1";
      if (key !== undefined) process.env.PRAMAAN_API_KEY = key;
    }
  });
});
