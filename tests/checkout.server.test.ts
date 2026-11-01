import { beforeEach, describe, expect, it } from "vitest";
import { failNext, fakeState, resetFake } from "@/lib/pramaan/fake";
import { finishFakeCheckout } from "@/lib/pramaan/fake-wave3";
import { get, post } from "./harness";

beforeEach(() => resetFake());

const made = () => fakeState().requests.filter((r) => r.path === "/v1/capabilities/payments.checkout.create");

describe("checkout server half", () => {
  it("makes a payment page for a plan and sends our own return pages", async () => {
    const res = await post(undefined, "/api/pramaan/checkout", { plan: "starter" }, { "Idempotency-Key": "click-1" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { checkoutUrl: string; ref: string };
    expect(body.checkoutUrl).toContain("/checkout/stand-in?ref=");
    const sent = made()[0];
    expect(sent.headers["idempotency-key"]).toBe("click-1");
    expect(sent.body).toMatchObject({ mode: "payment", successUrl: "http://app.test/checkout/done", cancelUrl: "http://app.test/checkout" });
  });

  it("reads the price on the server: a price in the request is ignored", async () => {
    await post(undefined, "/api/pramaan/checkout", { plan: "starter", amount: 1, amountCents: 1, lineItems: [{ name: "x", amount: 1, currency: "usd" }] });
    expect((made()[0].body as { lineItems: { amount: number }[] }).lineItems[0].amount).toBe(2_000);
  });

  it("a repeating plan is a subscription with its interval", async () => {
    await post(undefined, "/api/pramaan/checkout", { plan: "team", quantity: 3, email: "pat@example.com" });
    expect(made()[0].body).toMatchObject({ mode: "subscription", customerEmail: "pat@example.com", lineItems: [{ amount: 9_900, quantity: 3, interval: "month" }] });
  });

  it("refuses an unknown plan, a bad quantity and a bad email before any call", async () => {
    for (const [body, words] of [
      [{ plan: "nope" }, "isn't available"],
      [{}, "isn't available"],
      [{ plan: "starter", quantity: 0 }, "quantity"],
      [{ plan: "starter", quantity: 1.5 }, "quantity"],
      [{ plan: "starter", email: "nope" }, "email"],
    ] as const) {
      const res = await post(undefined, "/api/pramaan/checkout", body);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: { message: string } }).error.message).toContain(words);
    }
    expect(made()).toHaveLength(0);
  });

  it("says waiting until the payment is captured, then paid", async () => {
    const { ref } = (await (await post(undefined, "/api/pramaan/checkout", { plan: "starter" })).json()) as { ref: string };
    expect(await (await get(undefined, `/api/pramaan/checkout?ref=${ref}`)).json()).toEqual({ state: "waiting" });
    finishFakeCheckout(fakeState(), ref, "paid");
    expect(await (await get(undefined, `/api/pramaan/checkout?ref=${ref}`)).json()).toEqual({ state: "paid" });
  });

  it("a completed checkout with no captured payment is not paid", async () => {
    const { ref } = (await (await post(undefined, "/api/pramaan/checkout", { plan: "starter" })).json()) as { ref: string };
    finishFakeCheckout(fakeState(), ref, "cancelled");
    expect(await (await get(undefined, `/api/pramaan/checkout?ref=${ref}`)).json()).toEqual({ state: "cancelled" });
  });

  it("refuses a bad reference before any call, and passes the API's message through", async () => {
    const bad = await get(undefined, "/api/pramaan/checkout?ref=../etc");
    expect(bad.status).toBe(400);
    expect(fakeState().requests.some((r) => r.path.endsWith("payments.checkout.get"))).toBe(false);
    const gone = await get(undefined, "/api/pramaan/checkout?ref=ref_NOSUCH1");
    expect(gone.status).toBe(404);
    failNext("POST", "/v1/capabilities/payments.checkout.create", 502, { code: "upstream_unavailable", message: "The payment service is busy.", next: "Try again in a minute." });
    const res = await post(undefined, "/api/pramaan/checkout", { plan: "starter" });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: { code: "upstream_unavailable", message: "The payment service is busy.", next: "Try again in a minute." } });
  });

  it("no provider name in what the browser gets", async () => {
    const text = await (await post(undefined, "/api/pramaan/checkout", { plan: "starter" })).text();
    expect(text).not.toMatch(/stripe|adyen|paddle|paypal|dodo|airwallex/i);
  });
});
