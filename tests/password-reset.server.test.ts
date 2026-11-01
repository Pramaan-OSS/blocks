import { beforeEach, expect, it, vi } from "vitest";
import { createPasswordReset, hashResetPassword, proofHash, RESET_ANSWER, RESET_LIFETIME_MS, verifyResetPassword } from "@/lib/pramaan/password-reset";
import { memoryResetStore } from "@/lib/pramaan/password-reset-store";
import { capabilityResetSender } from "@/lib/pramaan/password-reset-sender";
import { fakeState, resetFake } from "@/lib/pramaan/fake";
import { clearAfter, flushAfter } from "./next-server";
import type { ResetSender } from "@/lib/pramaan/password-reset-sender";

const origin = "http://localhost:3304";
const initial = "Starting password 42";
const next = "A different password 73";
let state: ReturnType<typeof memoryResetStore>;
let now: number;
let user: string | undefined;
let mail: { text: string; key: string }[];
let sender: ResetSender;
beforeEach(async () => {
  clearAfter(); resetFake(); state = memoryResetStore(); now = 1_000_000; user = undefined; mail = [];
  state.users.set("person", { id: "person", email: "sam@example.com", passwordHash: await hashResetPassword(initial) });
  state.sessions.set("existing-session", "person");
  sender = { send: async (message, key) => { mail.push({ text: message.text, key }); return "accepted"; } };
});
const service = () => createPasswordReset({ store: state.store, sender, origin, now: () => now, currentUser: async () => user });
const request = (body: unknown, ip = "192.0.2.1", headers: Record<string, string> = {}) => new Request(`${origin}/api/pramaan/password-reset`, { method: "POST", headers: { origin, "content-type": "application/json", "x-forwarded-for": ip, ...headers }, body: JSON.stringify(body) });
const call = async (body: unknown, ip?: string) => {
  const response = await service().handle(request(body, ip));
  await flushAfter();
  return response;
};
const ask = (email = "sam@example.com", ip?: string) => call({ action: "request", email }, ip);
const token = () => /#token=([A-Za-z0-9_-]{43})/.exec(mail.at(-1)!.text)![1];

it("gives identical public answers for known, unknown and failed delivery without returning proof", async () => {
  const known = await ask(); const unknown = await ask("missing@example.com");
  sender = { send: async () => { throw new Error("Private delivery details"); } };
  const failed = await ask();
  for (const response of [known, unknown, failed]) {
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ message: RESET_ANSWER });
  }
  expect(mail).toHaveLength(1);
});

it("stores only a hashed random proof, binds the link to the configured origin and sends once", async () => {
  await ask();
  const proof = token();
  expect(mail[0].text).toContain(`${origin}/password-reset#token=${proof}`);
  expect(mail[0].key).toBe(`password-reset-${proofHash(proof)}`);
  expect([...state.proofs.values()]).toEqual([{ hash: proofHash(proof), userId: "person", passwordHash: state.users.get("person")!.passwordHash, expiresAt: now + RESET_LIFETIME_MS }]);
  expect(JSON.stringify([...state.proofs])).not.toContain(proof);
});

it("consumes a proof once, changes the password and ends sessions, including concurrent submissions", async () => {
  await ask(); const proof = token();
  const results = await Promise.all([call({ action: "reset", token: proof, password: next }), call({ action: "reset", token: proof, password: "Another valid password" })]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
  expect(state.proofs.size).toBe(0); expect(state.sessions.size).toBe(0);
  const hash = state.users.get("person")!.passwordHash;
  expect(await verifyResetPassword(initial, hash)).toBe(false);
  expect(await verifyResetPassword(next, hash) || await verifyResetPassword("Another valid password", hash)).toBe(true);
  expect((await call({ action: "reset", token: proof, password: next })).status).toBe(400);
});

it("refuses expired, replaced, malformed and missing proofs without changing the password", async () => {
  await ask(); const old = token(); await ask(); const current = token();
  expect(old).not.toBe(current);
  expect((await call({ action: "reset", token: old, password: next })).status).toBe(400);
  now += RESET_LIFETIME_MS;
  for (const proof of [current, "bad", undefined]) expect((await call({ action: "reset", token: proof, password: next })).status).toBe(400);
  expect(await verifyResetPassword(initial, state.users.get("person")!.passwordHash)).toBe(true);
});

it("requires a session and current password for a change, then invalidates links and sessions", async () => {
  await ask(); const proof = token();
  const body = { action: "change", currentPassword: initial, password: next };
  expect((await call(body)).status).toBe(401);
  user = "person";
  expect((await call({ ...body, currentPassword: "wrong" })).status).toBe(400);
  expect((await call(body)).status).toBe(200);
  expect(await verifyResetPassword(next, state.users.get("person")!.passwordHash)).toBe(true);
  expect(state.sessions.size).toBe(0); expect(state.proofs.size).toBe(0);
  expect((await call({ action: "reset", token: proof, password: initial })).status).toBe(400);
});

it("rejects a proof issued against a password that has since changed", async () => {
  const account = (await state.store.find("sam@example.com"))!;
  await state.store.change(account.id, account.passwordHash, await hashResetPassword(next));
  await state.store.issue({ hash: proofHash("old"), userId: account.id, passwordHash: account.passwordHash, expiresAt: now + 10_000 });
  expect(state.proofs.size).toBe(0);
});

it("limits normalized email addresses across IPs and IPs across email addresses", async () => {
  for (let n = 0; n < 3; n++) expect((await ask(n === 1 ? " SAM@example.com " : "sam@example.com", `192.0.2.${n + 1}`)).status).toBe(200);
  expect((await ask("sam@example.com", "192.0.2.99")).status).toBe(429);
  for (let n = 0; n < 10; n++) expect((await ask(`missing${n}@example.com`, "198.51.100.1")).status).toBe(200);
  expect((await ask("other@example.com", "198.51.100.1")).status).toBe(429);
  now += 15 * 60_000;
  expect((await ask("sam@example.com", "192.0.2.99")).status).toBe(200);
});

it("rejects weak passwords, cross-origin requests, oversized bodies and invalid input", async () => {
  await ask(); const proof = token();
  expect((await call({ action: "reset", token: proof, password: "short" })).status).toBe(400);
  expect((await service().handle(request({ action: "request", email: "sam@example.com" }, undefined, { origin: "https://elsewhere.example" }))).status).toBe(403);
  expect((await call({ action: "request", email: "x".repeat(5000) })).status).toBe(413);
  for (const body of [null, [], { action: "request", email: "bad" }, { action: "other" }]) expect((await call(body)).status).toBe(400);
  expect(state.proofs.size).toBe(1);
  expect(() => createPasswordReset({ store: state.store, sender, origin: "http://untrusted.example", currentUser: async () => undefined })).toThrow();
});

it("refuses capability delivery without disclosing a reset to the shared fake", async () => {
  sender = capabilityResetSender("account@example.com");
  await ask();
  const writes = fakeState().requests.filter((r) => r.path === "/v1/capabilities/email.send");
  expect(writes).toHaveLength(0);
  expect(state.proofs.size).toBe(0);
});

it("refuses password actions safely when storage fails, without printing private errors", async () => {
  const spy = vi.spyOn(console, "error");
  state.store.redeem = async () => { throw new Error("Private database details"); };
  const response = await call({ action: "reset", token: "a".repeat(43), password: next });
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("Private");
  expect(spy).not.toHaveBeenCalled(); spy.mockRestore();
});
