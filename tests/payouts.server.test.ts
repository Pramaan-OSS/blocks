import { beforeEach, describe, expect, it } from "vitest";
import { failNext, fakeState, resetFake } from "@/lib/pramaan/fake";
import { setFakeAccount } from "@/lib/pramaan/fake-wave3";
import { get, post } from "./harness";

beforeEach(() => resetFake());

const called = (id: string) => fakeState().requests.filter((r) => r.path === `/v1/capabilities/${id}`);

describe("payouts server half", () => {
  it("reads the account in plain words, with what is still needed", async () => {
    const res = await get("mbr_owner", "/api/pramaan/payouts");
    expect(await res.json()).toEqual({ state: "pending", canTakePayments: false, canReceivePayouts: false, due: ["A bank account to receive payouts", "Your business website"], canManage: true });
    setFakeAccount(fakeState(), { status: "ready" });
    expect(await (await get("mbr_owner", "/api/pramaan/payouts")).json()).toMatchObject({ state: "ready", canTakePayments: true, canReceivePayouts: true, due: [] });
  });

  it("an unknown requirement still reads as words, not a key", async () => {
    setFakeAccount(fakeState(), { status: "restricted", due: ["individual.verification.document"] });
    const a = (await (await get("mbr_owner", "/api/pramaan/payouts")).json()) as { due: string[] };
    expect(a.due).toEqual(["Individual verification document"]);
  });

  it("needs a signed-in person", async () => {
    const res = await get("none", "/api/pramaan/payouts");
    expect(res.status).toBe(401);
    expect(called("payments.account.status")).toHaveLength(0);
  });

  it("opens a setup session for an owner: connects, then asks for the session, and the required screens are always on", async () => {
    const res = await post("mbr_owner", "/api/pramaan/payouts/session", { view: "manage" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    const s = (await res.json()) as { mode: string; clientSecret: string; publishableKey: string; standIn: boolean };
    expect(s).toMatchObject({ mode: "embedded", publishableKey: "pk_test_FAKE1", standIn: true });
    expect(s.clientSecret).toMatch(/^fake_secret_/);
    expect(called("payments.account.connect")[0].body).toMatchObject({ returnUrl: "http://app.test/payouts" });
    expect(called("payments.account.session.create")[0].body).toEqual({ components: ["payouts", "balances"] });
  });

  it("a member who can't manage gets no session and no call is made", async () => {
    const res = await post("mbr_viewer", "/api/pramaan/payouts/session", {});
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain("Only an owner or admin");
    expect(called("payments.account.connect")).toHaveLength(0);
    const read = await get("mbr_viewer", "/api/pramaan/payouts");
    expect(((await read.json()) as { canManage: boolean }).canManage).toBe(false);
  });

  it("an older account sets up on a hosted page, so no session is made", async () => {
    setFakeAccount(fakeState(), { hosted: true });
    const s = await (await post("mbr_owner", "/api/pramaan/payouts/session", {})).json();
    expect(s).toEqual({ mode: "hosted", url: "https://onboarding.fake/setup#abc" });
    expect(called("payments.account.session.create")).toHaveLength(0);
  });

  it("refuses an unknown view, and passes the API's message through", async () => {
    expect((await post("mbr_owner", "/api/pramaan/payouts/session", { view: "everything" })).status).toBe(400);
    expect(called("payments.account.connect")).toHaveLength(0);
    failNext("POST", "/v1/capabilities/payments.account.status", 502, { code: "upstream_unavailable", message: "The payment service is busy.", next: "Try again soon." });
    const res = await get("mbr_owner", "/api/pramaan/payouts");
    expect(await res.json()).toEqual({ error: { code: "upstream_unavailable", message: "The payment service is busy.", next: "Try again soon." } });
  });
});
