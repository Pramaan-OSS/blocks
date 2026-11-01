// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CheckoutButton, CheckoutStatus } from "@/components/pramaan/checkout/checkout-button";
import { formatCents as money } from "@/lib/pramaan/plain";
import { failNext, fakeState, resetFake } from "@/lib/pramaan/fake";
import { finishFakeCheckout } from "@/lib/pramaan/fake-wave3";
import { appFetch } from "./harness";

beforeEach(() => {
  resetFake();
  sessionStorage.clear();
  vi.stubGlobal("fetch", appFetch());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CheckoutButton", () => {
  it("sends the customer to the payment page and keeps the reference in the browser", async () => {
    const go = vi.fn();
    render(<CheckoutButton plan="starter" label="Pay for Starter" onRedirect={go} />);
    await userEvent.click(screen.getByRole("button", { name: "Pay for Starter" }));
    await waitFor(() => expect(go).toHaveBeenCalledTimes(1));
    expect(go.mock.calls[0][0]).toContain("/checkout/stand-in");
    expect(sessionStorage.getItem("pramaan-checkout-ref")).toMatch(/^ref_/);
  });

  it("a double click makes one payment page", async () => {
    const go = vi.fn();
    render(<CheckoutButton plan="starter" onRedirect={go} />);
    const button = screen.getByRole("button", { name: "Pay now" });
    await userEvent.dblClick(button);
    await waitFor(() => expect(go).toHaveBeenCalled());
    expect(fakeState().requests.filter((r) => r.path.endsWith("payments.checkout.create"))).toHaveLength(1);
  });

  it("shows the server's own message when it fails, and the button works again", async () => {
    failNext("POST", "/v1/capabilities/payments.checkout.create", 502, { code: "upstream_unavailable", message: "The payment service is busy." });
    render(<CheckoutButton plan="starter" onRedirect={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Pay now" }));
    expect(await screen.findByText("The payment service is busy.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Pay now" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("formats cents as money", () => {
    expect(money(2_000)).toBe("$20.00");
    expect(money(9_950, "usd")).toBe("$99.50");
  });
});

describe("CheckoutStatus", () => {
  const start = async () => {
    const go = vi.fn();
    render(<CheckoutButton plan="starter" onRedirect={go} />);
    await userEvent.click(screen.getByRole("button", { name: "Pay now" }));
    await waitFor(() => expect(go).toHaveBeenCalled());
    cleanup();
    return sessionStorage.getItem("pramaan-checkout-ref")!;
  };

  it("waits, then says paid once the payment is captured", async () => {
    const ref = await start();
    render(<CheckoutStatus pollMs={30} />);
    expect(await screen.findByText("Waiting for payment")).toBeTruthy();
    finishFakeCheckout(fakeState(), ref, "paid");
    expect(await screen.findByText("Paid")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("went through");
    expect(document.body.textContent).not.toMatch(/ref_FAKE/);
  });

  it("says cancelled, with a way back", async () => {
    const ref = await start();
    finishFakeCheckout(fakeState(), ref, "cancelled");
    render(<CheckoutStatus pollMs={30} />);
    expect(await screen.findByText("Cancelled", {}, { timeout: 4_000 })).toBeTruthy();
    expect(await screen.findByRole("link", { name: "Back to the checkout" })).toBeTruthy();
  });

  it("with no payment in this browser, offers to start one", async () => {
    render(<CheckoutStatus />);
    expect(await screen.findByRole("link", { name: "Start a checkout" })).toBeTruthy();
  });
});
