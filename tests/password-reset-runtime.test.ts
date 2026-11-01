import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { configurePasswordReset, handlePasswordReset, passwordResetFake, resetPasswordResetFake } from "@/lib/pramaan/password-reset-runtime";
import { memoryResetStore } from "@/lib/pramaan/password-reset-store";
import { RESET_ANSWER } from "@/lib/pramaan/password-reset";
import { GET, POST } from "../app/api/demo/password-reset/route";
import { clearAfter, flushAfter } from "./next-server";

const origin = "http://localhost:3100";
const request = (body: unknown = {}, custom: Record<string, string> = {}) => new Request(`${origin}/api/demo/password-reset`, { method: "POST", headers: { origin, "content-type": "application/json", ...custom }, body: JSON.stringify(body) });
beforeEach(() => {
  clearAfter(); resetPasswordResetFake();
  delete (globalThis as Record<string, unknown>).__passwordResetOptions;
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("PRAMAAN_FAKE", "1");
  vi.stubEnv("PRAMAAN_PASSWORD_RESET_TEST_MODE", "");
  vi.stubEnv("PRAMAAN_PASSWORD_RESET_ORIGIN", origin);
});
afterEach(() => { resetPasswordResetFake(); delete (globalThis as Record<string, unknown>).__passwordResetOptions; vi.unstubAllEnvs(); });

it("8: uses the configured real store when fake mode is off and otherwise refuses unconfigured live requests", async () => {
  vi.stubEnv("PRAMAAN_FAKE", "0");
  expect((await handlePasswordReset(request())).status).toBe(503);
  const store = memoryResetStore(); const find = vi.spyOn(store.store, "find");
  configurePasswordReset({ store: store.store, sender: { send: async () => "accepted" }, origin, currentUser: async () => undefined });
  const response = await handlePasswordReset(request({ action: "request", email: "absent@example.com" }));
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ message: RESET_ANSWER });
  expect(find).not.toHaveBeenCalled(); await flushAfter(); expect(find).toHaveBeenCalledWith("absent@example.com");
  expect((await GET(new Request(`${origin}/api/demo/password-reset`, { headers: { origin } }))).status).toBe(404);
  expect((await POST(request({ action: "signin" }))).status).toBe(404);
});

it("8: fake requests use sample accounts only and do not call configured live storage", async () => {
  const store = memoryResetStore(); const find = vi.spyOn(store.store, "find");
  configurePasswordReset({ store: store.store, sender: { send: async () => "accepted" }, origin, currentUser: async () => undefined });
  expect((await handlePasswordReset(request({ action: "request", email: "sam@example.com" }))).status).toBe(200);
  await flushAfter(); expect(find).not.toHaveBeenCalled();
  const fake = await passwordResetFake();
  expect(fake.mail).toHaveLength(1);
});

it("9: production refuses sample accounts and mailbox routes even with a stray fake setting", async () => {
  vi.stubEnv("NODE_ENV", "production");
  expect((await handlePasswordReset(request({ action: "request", email: "sam@example.com" }))).status).toBe(503);
  await expect(passwordResetFake()).rejects.toThrow("Sample accounts are unavailable.");
  expect((await GET(new Request(`${origin}/api/demo/password-reset`, { headers: { origin } }))).status).toBe(404);
  expect((await POST(request({ action: "signin", password: "Starting password 42" }))).status).toBe(404);
});

it("9: the explicit production-build test exception is loopback-only", async () => {
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("PRAMAAN_PASSWORD_RESET_TEST_MODE", "1");
  vi.stubEnv("PRAMAAN_PASSWORD_RESET_ORIGIN", "https://public.example");
  expect((await handlePasswordReset(request())).status).toBe(503);
  vi.stubEnv("PRAMAAN_PASSWORD_RESET_ORIGIN", origin);
  expect((await handlePasswordReset(request({ action: "request", email: "absent@example.com" }))).status).toBe(200);
  await flushAfter();
  expect((await handlePasswordReset(new Request("https://public.example/api/pramaan/password-reset", { method: "POST", headers: { origin, "content-type": "application/json" }, body: '{}' }))).status).toBe(503);
});

it("9: sample mailbox requires same-origin access and sign-in attempts are limited", async () => {
  expect((await GET(new Request(`${origin}/api/demo/password-reset`))).status).toBe(403);
  expect((await GET(new Request(`${origin}/api/demo/password-reset`, { headers: { origin: "https://elsewhere.example" } }))).status).toBe(403);
  expect((await GET(new Request(`${origin}/api/demo/password-reset`, { headers: { "sec-fetch-site": "cross-site" } }))).status).toBe(403);
  expect((await GET(new Request(`${origin}/api/demo/password-reset`, { headers: { "sec-fetch-site": "same-origin" } }))).status).toBe(200);
  for (let n = 0; n < 5; n++) expect((await POST(request({ action: "signin", password: "wrong" }))).status).toBe(401);
  expect((await POST(request({ action: "signin", password: "wrong" }))).status).toBe(429);
});

it("9: demo sign-in sets Secure on HTTPS and the mailbox never caches links", async () => {
  vi.stubEnv("PRAMAAN_PASSWORD_RESET_ORIGIN", "https://localhost");
  const response = await POST(new Request("https://localhost/api/demo/password-reset", { method: "POST", headers: { origin: "https://localhost", "content-type": "application/json" }, body: JSON.stringify({ action: "signin", password: "Starting password 42" }) }));
  expect(response.status).toBe(200); expect(response.headers.get("set-cookie")).toContain("; Secure");
  const mailbox = await GET(new Request("https://localhost/api/demo/password-reset", { headers: { origin: "https://localhost" } }));
  expect(mailbox.headers.get("cache-control")).toBe("no-store");
});
