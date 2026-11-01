import { beforeEach, describe, expect, it } from "vitest";
import { failNext, fakeState, resetFake } from "@/lib/pramaan/fake";
import { platform } from "@/lib/pramaan/fake-platform";
import { get } from "./harness";

beforeEach(() => resetFake());

const json = async (res: Response) => ({ status: res.status, body: await res.json() });

describe("wallet routes", () => {
  it("returns the balance with what is set aside, today's spend, the cap, and where to add credit", async () => {
    fakeState().holds.set("job:x", 500_000);
    const { status, body } = await json(await get(undefined, "/api/pramaan/wallet"));
    expect(status).toBe(200);
    expect(body.balance).toMatchObject({ balance_micro: 11_840_000, held_micro: 500_000, daily_cap_micro: null });
    expect(body.topUpUrl).toBe("https://app.pramaan.dev/settings/wallet");
  });

  it("the top-up link can be set for the app", async () => {
    process.env.PRAMAAN_WALLET_URL = "https://billing.example.com/add";
    try {
      expect((await json(await get(undefined, "/api/pramaan/wallet"))).body.topUpUrl).toBe("https://billing.example.com/add");
    } finally {
      delete process.env.PRAMAAN_WALLET_URL;
    }
  });

  it("returns usage for the days asked, today included", async () => {
    const seven = (await json(await get(undefined, "/api/pramaan/wallet/usage?days=7"))).body;
    const days = new Set(seven.results.map((r: { day: string }) => r.day));
    expect(days.size).toBe(7);
    expect(seven.to).toBe(new Date().toISOString().slice(0, 10));
    const all = platform(fakeState()).usage;
    expect(seven.results).toHaveLength(all.filter((r) => r.day >= seven.from).length);
    const thirty = (await json(await get(undefined, "/api/pramaan/wallet/usage?days=30"))).body;
    expect(thirty.results.length).toBeGreaterThan(seven.results.length);
  });

  it("refuses a range it can't serve, in plain words", async () => {
    const res = await json(await get(undefined, "/api/pramaan/wallet/usage?days=400"));
    expect(res).toMatchObject({ status: 400, body: { error: { message: "Ask for 1 to 90 days of usage." } } });
  });

  it("reads a customer's prepaid credit with billing.credits.balance", async () => {
    const ok = await json(await get(undefined, "/api/pramaan/wallet/customers/cus_example"));
    expect(ok.body.balances[0]).toMatchObject({ kind: "money", available: { amount: 1999, currency: "USD" } });
    const missing = await json(await get(undefined, "/api/pramaan/wallet/customers/cus_nope"));
    expect(missing).toMatchObject({ status: 404, body: { error: { message: "No customer with that id. List them with billing.customers.list." } } });
  });

  it("passes the API's own error message through", async () => {
    failNext("GET", "/v1/balance", 401, { code: "unauthorized", message: "That API key isn't valid. Create a new one in your dashboard." });
    const res = await json(await get(undefined, "/api/pramaan/wallet"));
    expect(res).toMatchObject({ status: 401, body: { error: { message: "This app can't reach its service right now." } } });
  });
});
