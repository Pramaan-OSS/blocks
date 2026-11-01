import { scryptSync } from "node:crypto";
import { expect, it } from "vitest";
import { hashResetPassword, verifyResetPassword, verifyAndUpgradeResetPassword, resetPasswordNeedsUpgrade } from "@/lib/pramaan/password-reset";
import { memoryResetStore } from "@/lib/pramaan/password-reset-store";

it("6: writes a parameterized stronger hash and verifies it without changing legacy passwords", async () => {
  const password = "A sufficiently long password 52";
  const hash = await hashResetPassword(password);
  expect(resetPasswordNeedsUpgrade(hash)).toBe(false);
  expect(hash).toMatch(/^scrypt\$N=131072,r=8,p=1\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
  expect(await verifyResetPassword(password, hash)).toBe(true);
  expect(await verifyResetPassword("wrong password", hash)).toBe(false);
  const salt = "ab".repeat(16);
  const key = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString("hex");
  expect(await verifyResetPassword(password, `scrypt:${salt}:${key}`)).toBe(true);
  // Parameterized earlier costs remain readable when the write cost changes again.
  expect(await verifyResetPassword(password, `scrypt$N=16384,r=8,p=1$${salt}$${key}`)).toBe(true);
  for (const encoded of [hash.replace("N=131072", "N=999999999"), hash.replace("p=1", "p=0"), hash.replace("r=8", "r=99999"), "scrypt$broken"]) {
    expect(await verifyResetPassword(password, encoded)).toBe(false);
  }
});

it("6: upgrades a legacy hash only after successful sign-in verification", async () => {
  const password = "A sufficiently long password 52"; const salt = "cd".repeat(16);
  const key = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString("hex");
  const passwordHash = `scrypt:${salt}:${key}`;
  const state = memoryResetStore(); const account = { id: "person", email: "sam@example.com", passwordHash };
  state.users.set(account.id, { ...account }); state.sessions.set("old-session", account.id);
  expect(resetPasswordNeedsUpgrade(passwordHash)).toBe(true);
  expect(await verifyAndUpgradeResetPassword(state.store, account, "incorrect")).toBe(false);
  expect(state.users.get(account.id)!.passwordHash).toBe(passwordHash);
  expect(await verifyAndUpgradeResetPassword(state.store, account, password)).toBe(true);
  const upgraded = state.users.get(account.id)!.passwordHash;
  expect(resetPasswordNeedsUpgrade(upgraded)).toBe(false);
  expect(await verifyResetPassword(password, upgraded)).toBe(true);
  expect(state.sessions.size).toBe(0);
});
