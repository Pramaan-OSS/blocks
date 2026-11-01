import { beforeEach, describe, expect, it } from "vitest";
import { failNext, fakeState, resetFake } from "@/lib/pramaan/fake";
import { laneCState } from "@/lib/pramaan/fake-wave3";
import { recordUsage } from "@/lib/pramaan/subscriptions";
import { callRoute, post } from "./harness";

const PLANS = "/api/pramaan/subscriptions";
const PORTAL = "/api/pramaan/subscriptions/portal";
beforeEach(() => resetFake());

const as = (customer: string | undefined, url: string, init: RequestInit = {}) =>
  callRoute(new Request(new URL(url, "http://app.test"), { ...init, headers: { ...(init.headers as Record<string, string>), ...(customer ? { cookie: `pramaan_customer=${customer}` } : {}) } }));
const calls = (id: string) => fakeState().requests.filter((r) => r.path === `/v1/capabilities/${id}`);

describe("subscriptions routes", () => {
  it("shows the signed-in customer's own plan, in major units, with no ids", async () => {
    const res = await as(undefined, PLANS);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.plans).toHaveLength(1);
    expect(body.plans[0]).toMatchObject({ status: "active", amount: 29, currency: "usd", interval: "month", intervalCount: 1 });
    expect(body.plans[0].nextBillingAt).toBeTruthy();
    expect(JSON.stringify(body)).not.toMatch(/sub_|cus_/);
  });

  it("asks only about the customer the server knows: a customer in the request is ignored", async () => {
    const body = await (await as("cus_FAKE0002", `${PLANS}?customerId=cus_FAKE0001`)).json();
    expect(body.plans[0].amount).toBe(99);
    expect(calls("billing.subscriptions.list").map((r) => (r.body as { customerId: string }).customerId)).toEqual(["cus_FAKE0002"]);
  });

  it("a plan that ends at the end of the period says when", async () => {
    laneCState(fakeState()).subs.get("sub_FAKE0001")!.cancelAtPeriodEnd = true;
    const [plan] = (await (await as(undefined, PLANS)).json()).plans;
    expect(plan.endsAt).toBeTruthy();
  });

  it("a customer with no plan gets an empty list", async () => {
    expect((await (await as("cus_FAKE0099", PLANS)).json()).plans).toEqual([]);
  });

  it("makes a billing page link that returns to our own page, and never sends a customer from the browser", async () => {
    const res = await post(undefined, PORTAL, { customerId: "cus_FAKE0002", returnUrl: "https://evil.example" });
    expect(res.status).toBe(200);
    const { url } = (await res.json()) as { url: string };
    expect(url).toContain("/subscriptions/stand-in?customer=cus_FAKE0001");
    expect(calls("billing.portal.create")[0].body).toEqual({ customerId: "cus_FAKE0001", returnUrl: "http://app.test/subscriptions" });
  });

  it("the page to come back to is a path on this site only", async () => {
    expect((await post(undefined, PORTAL, { returnPath: "/account" })).status).toBe(200);
    for (const returnPath of ["https://evil.example", "//evil.example", "account", 5, "/a b"]) {
      expect((await post(undefined, PORTAL, { returnPath })).status, String(returnPath)).toBe(400);
    }
    expect(calls("billing.portal.create")).toHaveLength(1);
  });

  it("passes the API's own message through when the link can't be made", async () => {
    failNext("POST", "/v1/capabilities/billing.portal.create", 404, { code: "not_found", message: "Customer not found in your billing account." });
    const res = await post(undefined, PORTAL, {});
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe("Customer not found in your billing account.");
  });

  it("until you wire your own sign-in nobody is a customer: a plain answer and no call", async () => {
    const was = process.env.PRAMAAN_FAKE;
    process.env.PRAMAAN_FAKE = "0";
    try {
      const res = await as(undefined, PLANS);
      expect(res.status).toBe(401);
      expect(((await res.json()) as { error: { message: string } }).error.message).toBe("Sign in to see this.");
      expect((await post(undefined, PORTAL, {})).status).toBe(401);
    } finally {
      process.env.PRAMAAN_FAKE = was;
    }
    expect(fakeState().requests.filter((r) => r.path.startsWith("/v1/capabilities/billing"))).toHaveLength(0);
  });
});

describe("recordUsage (server code, not a route)", () => {
  it("records an event once per key, and says when it was a repeat", async () => {
    expect(await recordUsage("cus_FAKE0001", "api_call", { units: 3 }, "k1")).toEqual({ duplicate: false });
    expect(await recordUsage("cus_FAKE0001", "api_call", { units: 3 }, "k1")).toEqual({ duplicate: true });
    expect(calls("billing.usage.record")[0].body).toEqual({ customerId: "cus_FAKE0001", event: "api_call", properties: { units: 3 } });
  });

  it("refuses an empty customer or event before any call", async () => {
    await expect(recordUsage("", "x")).rejects.toThrow("Say which customer and which event to record.");
    await expect(recordUsage("cus_FAKE0001", " ")).rejects.toThrow();
    expect(calls("billing.usage.record")).toHaveLength(0);
  });

  it("there is no route that records usage", async () => {
    expect((await post(undefined, "/api/pramaan/subscriptions/usage", { customerId: "cus_FAKE0001", event: "x" })).status).toBe(404);
  });
});
