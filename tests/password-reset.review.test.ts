import { beforeEach, expect, it, vi } from "vitest";
import { createPasswordReset, proofHash, RESET_ANSWER } from "@/lib/pramaan/password-reset";
import { memoryResetStore } from "@/lib/pramaan/password-reset-store";
import { capabilityResetSender, type ResetMail } from "@/lib/pramaan/password-reset-sender";
import { fakeState, resetFake } from "@/lib/pramaan/fake";
import { clearAfter, flushAfter } from "./next-server";

const origin = "http://localhost:3304";
const headers = { origin, "content-type": "application/json", "x-forwarded-for": "192.0.2.1" };
const request = (body: unknown, custom: Record<string, string> = headers, url = `${origin}/api/pramaan/password-reset`) => new Request(url, { method: "POST", headers: custom, body: JSON.stringify(body) });
let state: ReturnType<typeof memoryResetStore>;
beforeEach(() => {
  clearAfter(); resetFake(); state = memoryResetStore();
  state.users.set("person", { id: "person", email: "sam@example.com", passwordHash: "saved-hash" });
});

it("1: never submits a reset proof to an approvable capability and leaves no redeemable proof", async () => {
  const app = createPasswordReset({ store: state.store, sender: capabilityResetSender("account@example.com"), origin, currentUser: async () => undefined });
  expect((await app.handle(request({ action: "request", email: "sam@example.com" }))).status).toBe(200);
  await flushAfter();
  expect(fakeState().requests.filter((r) => r.path === "/v1/capabilities/email.send")).toHaveLength(0);
  expect(fakeState().approvals.size).toBe(2); // Only the seeded sample approvals, never a reset.
  expect(state.proofs.size).toBe(0);
});

it("2: known and unknown addresses answer before slow account lookup or delivery", async () => {
  const find = state.store.find;
  const lookups = vi.fn(async (email: string) => { await new Promise((resolve) => setTimeout(resolve, 50)); return find(email); });
  state.store.find = lookups;
  const send = vi.fn(async () => { await new Promise((resolve) => setTimeout(resolve, 500)); return "accepted" as const; });
  const app = createPasswordReset({ store: state.store, sender: { send }, origin, currentUser: async () => undefined });
  const elapsed = [];
  for (const email of ["sam@example.com", "missing@example.com"]) {
    const start = performance.now();
    expect(await (await app.handle(request({ action: "request", email }))).json()).toEqual({ message: RESET_ANSWER });
    elapsed.push(performance.now() - start);
  }
  expect(Math.max(...elapsed)).toBeLessThan(100);
  expect(Math.abs(elapsed[0] - elapsed[1])).toBeLessThan(50);
  expect(lookups).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
  await flushAfter();
  expect(lookups).toHaveBeenCalledTimes(2); expect(send).toHaveBeenCalledTimes(1);
});

it("3: missing or failed bot checks refuse request and redemption before any account or password work", async () => {
  vi.stubEnv("PRAMAAN_BOT_CHECK_SECRET", "enabled");
  const send = vi.fn(async () => "accepted" as const);
  const find = vi.spyOn(state.store, "find"); const redeem = vi.spyOn(state.store, "redeem");
  const app = createPasswordReset({ store: state.store, sender: { send }, origin, currentUser: async () => undefined });
  for (const action of ["request", "reset"]) for (const botCheckToken of [undefined, "bad-token"]) {
    const response = await app.handle(request({ action, email: "sam@example.com", password: "New password long enough", token: "a".repeat(43), botCheckToken }));
    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe("Please complete the security check and try again.");
  }
  await flushAfter();
  expect(send).not.toHaveBeenCalled(); expect(find).not.toHaveBeenCalled(); expect(redeem).not.toHaveBeenCalled();
});

it("3: a successful public bot check allows the request and a fresh check allows redemption", async () => {
  vi.stubEnv("PRAMAAN_BOT_CHECK_SECRET", "enabled");
  const send = vi.fn(async (_mail: ResetMail, _key: string) => "accepted" as const);
  const app = createPasswordReset({ store: state.store, sender: { send }, origin, currentUser: async () => undefined });
  expect((await app.handle(request({ action: "request", email: "sam@example.com", botCheckToken: "test-token" }))).status).toBe(200);
  await flushAfter();
  const token = /#token=([A-Za-z0-9_-]{43})/.exec(send.mock.calls[0][0].text)![1];
  expect((await app.handle(request({ action: "reset", password: "A long new password 32", token, botCheckToken: "test-token" }))).status).toBe(200);
  const checks = fakeState().requests.filter((r) => r.path === "/v1/capabilities/auth.bot-check.verify");
  expect(checks).toHaveLength(2);
  expect(checks[0].body).toMatchObject({ remoteIp: "192.0.2.1" });
});

it("4: missing IPs use the shared fallback allowance and warn once", async () => {
  delete (globalThis as typeof globalThis & { __pramaanIpWarningShown?: boolean }).__pramaanIpWarningShown;
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  const app = createPasswordReset({ store: state.store, sender: { send: async () => "accepted" }, origin, currentUser: async () => undefined });
  try {
    for (let n = 0; n < 100; n++) {
      const response = await app.handle(request({ action: "request", email: `absent${n}@example.com` }, { origin, "content-type": "application/json" }));
      expect(response.status).toBe(200);
    }
    expect((await app.handle(request({ action: "request", email: "absent100@example.com" }, { origin, "content-type": "application/json" }))).status).toBe(429);
    expect(warning).toHaveBeenCalledTimes(1);
    await flushAfter();
  } finally { warning.mockRestore(); }
});

it("7: ignores a hostile request URL and Host header when constructing the emailed link", async () => {
  const send = vi.fn(async (_mail: ResetMail, _key: string) => "accepted" as const);
  const app = createPasswordReset({ store: state.store, sender: { send }, origin, currentUser: async () => undefined });
  await app.handle(request({ action: "request", email: "sam@example.com" }, { ...headers, host: "attacker.example" }, "https://attacker.example/api/pramaan/password-reset"));
  await flushAfter();
  expect(send).toHaveBeenCalledOnce();
  expect(send.mock.calls[0][0].text).toContain(`${origin}/password-reset#token=`);
  expect(send.mock.calls[0][0].text).not.toContain("attacker.example");
});

it("8: rejects an issued proof if the password hash changed outside this store", async () => {
  const hash = proofHash("proof");
  await state.store.issue({ hash, userId: "person", passwordHash: "saved-hash", expiresAt: Date.now() + 60_000 });
  state.users.get("person")!.passwordHash = "changed-elsewhere";
  expect(await state.store.redeem(hash, "must-not-save", Date.now())).toBe(false);
  expect(state.users.get("person")!.passwordHash).toBe("changed-elsewhere");
});

it("10: records count-only outcomes, revokes unsuccessful proofs and never logs addresses, secrets or upstream errors", async () => {
  const log = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    for (const outcome of ["not-sent", "unknown", "throw"] as const) {
      const app = createPasswordReset({ store: state.store, sender: { send: async () => { if (outcome === "throw") throw new Error("private-transport-secret"); return outcome; } }, origin, currentUser: async () => undefined });
      await app.handle(request({ action: "request", email: "sam@example.com" }));
      await flushAfter();
      expect(state.proofs.size).toBe(0);
    }
    expect(log.mock.calls).toEqual(["not-sent", "unknown", "failed"].map((outcome) => ["Password reset delivery.", { outcome, count: 1 }]));
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/sam@|token=|private-transport-secret|saved-hash/);
  } finally { log.mockRestore(); }
});

it("10: explains malformed form data in plain words", async () => {
  const app = createPasswordReset({ store: state.store, sender: { send: async () => "accepted" }, origin, currentUser: async () => undefined });
  const response = await app.handle(new Request(`${origin}/api/pramaan/password-reset`, { method: "POST", headers, body: "broken" }));
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ message: "Something in the form was not accepted. Refresh the page and try again." });
});
