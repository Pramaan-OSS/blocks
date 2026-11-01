import { beforeEach, describe, expect, it } from "vitest";
import { failNext, fakeState, resetFake } from "@/lib/pramaan/fake";
import { finishFakeVerification } from "@/lib/pramaan/fake-wave3";
import { get, post } from "./harness";

beforeEach(() => resetFake());

const made = () => fakeState().requests.filter((r) => r.path === "/v1/capabilities/identity.verification.create");
const start = async () => ((await (await post("mbr_owner", "/api/pramaan/identity", {}, { "Idempotency-Key": "k1" })).json()) as { url: string; ref: string });

describe("identity check server half", () => {
  it("starts a check for the signed-in person with our own user reference, once per click key", async () => {
    const s = await start();
    expect(s.url).toContain("/identity/stand-in?ref=");
    expect(made()[0].body).toEqual({ endUserId: "user-42" });
    expect(made()[0].headers["idempotency-key"]).toBe("k1");
    await post("mbr_owner", "/api/pramaan/identity", { language: "es" });
    expect(made()[1].body).toEqual({ endUserId: "user-42", language: "es" });
  });

  it("refuses a bad language before any call", async () => {
    const res = await post("mbr_owner", "/api/pramaan/identity", { language: "English please" });
    expect(res.status).toBe(400);
    expect(made()).toHaveLength(0);
  });

  it("reads the decision and each check in words, and passes on none of the personal facts", async () => {
    const { ref } = await start();
    expect(await (await get(undefined, `/api/pramaan/identity?ref=${ref}`)).json()).toEqual({ state: "waiting", checks: [] });
    finishFakeVerification(fakeState(), ref, "approved");
    const text = await (await get(undefined, `/api/pramaan/identity?ref=${ref}`)).text();
    expect(JSON.parse(text)).toEqual({ state: "approved", checks: [{ label: "ID document", result: "Passed" }, { label: "Selfie check", result: "Passed" }, { label: "Face match", result: "Passed" }] });
    expect(text).not.toMatch(/Lovelace|1990|X1234567|didit|digio/i);
  });

  it("declined, in review and in progress read as such, never as approved", async () => {
    const { ref } = await start();
    for (const [status, state] of [["declined", "declined"], ["in_review", "in_review"], ["in_progress", "in_progress"]] as const) {
      finishFakeVerification(fakeState(), ref, status);
      expect(((await (await get(undefined, `/api/pramaan/identity?ref=${ref}`)).json()) as { state: string }).state).toBe(state);
    }
  });

  it("a bad reference is refused before any call", async () => {
    const res = await get(undefined, "/api/pramaan/identity?ref=../x");
    expect(res.status).toBe(400);
    expect(fakeState().requests.some((r) => r.path.endsWith("identity.verification.get"))).toBe(false);
  });

  it("passes the API's message through", async () => {
    failNext("POST", "/v1/capabilities/identity.verification.create", 502, { code: "upstream_unavailable", message: "The check service is busy.", next: "Try again soon." });
    const res = await post("mbr_owner", "/api/pramaan/identity", {});
    expect(await res.json()).toEqual({ error: { code: "upstream_unavailable", message: "The check service is busy.", next: "Try again soon." } });
    expect((await get(undefined, "/api/pramaan/identity?ref=ref_NOSUCH1")).status).toBe(404);
  });
});
