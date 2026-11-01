import "server-only";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { clientIp, emailLimitKey, limitPublic, verifyPublicBot } from "@/lib/pramaan/public-guard";
import type { ResetSender } from "./password-reset-sender";

export type ResetAccount = { id: string; email: string; passwordHash: string };
export type ResetProof = { hash: string; userId: string; passwordHash: string; expiresAt: number };
export interface ResetStore {
  find(email: string): Promise<ResetAccount | undefined>;
  findById(id: string): Promise<ResetAccount | undefined>;
  issue(proof: ResetProof): Promise<void>;
  revoke(hash: string): Promise<void>;
  /** Atomically consume an unexpired proof, replace the password, delete all proofs and sessions. */
  redeem(hash: string, passwordHash: string, now: number): Promise<boolean>;
  /** Compare the old hash under a lock; replace it and delete all proofs and sessions together. */
  change(id: string, oldHash: string, passwordHash: string): Promise<boolean>;
}
export class PasswordResetError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const RESET_ANSWER = "If that email has an account, a password reset link will arrive shortly.";
export const RESET_LIFETIME_MS = 30 * 60_000;
export const proofHash = (proof: string) => createHash("sha256").update(proof).digest("hex");

let passwordWork = 0;
const SCRYPT = { N: 131072, r: 8, p: 1 };
async function derive(password: string, salt: string, parameters = SCRYPT): Promise<Buffer> {
  if (passwordWork >= 4) throw new PasswordResetError(429, "Please wait a moment and try again.");
  passwordWork++;
  try {
    return await new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 64, { ...parameters, maxmem: 256 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
  } finally { passwordWork--; }
}
export async function hashResetPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$N=${SCRYPT.N},r=${SCRYPT.r},p=${SCRYPT.p}$${salt}$${(await derive(password, salt)).toString("hex")}`;
}
export async function verifyResetPassword(password: string, encoded: string) {
  const legacy = /^scrypt:([a-f0-9]{32}):([a-f0-9]{128})$/.exec(encoded);
  const modern = /^scrypt\$N=(\d{1,6}),r=(\d{1,2}),p=(\d{1,2})\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(encoded);
  const salt = legacy?.[1] ?? modern?.[4]; const key = legacy?.[2] ?? modern?.[5];
  if (!salt || !key) return false;
  const parameters = legacy ? { N: 16384, r: 8, p: 1 } : { N: Number(modern![1]), r: Number(modern![2]), p: Number(modern![3]) };
  // Read older costs, but never let a corrupt row select unbounded work or memory.
  if (![16384, 32768, 65536, 131072].includes(parameters.N) || parameters.r !== 8 || parameters.p < 1 || parameters.N * parameters.p > 131072) return false;
  return timingSafeEqual(await derive(password, salt, parameters), Buffer.from(key, "hex"));
}

/** Hosts can upgrade a successfully verified password on the next sign-in. Changes always upgrade. */
export const resetPasswordNeedsUpgrade = (encoded: string) => !encoded.startsWith("scrypt$N=131072,r=8,p=1$");

/** Sign-in integration: verify first, then replace an older hash with a compare-and-set. */
export async function verifyAndUpgradeResetPassword(store: ResetStore, account: ResetAccount, password: string) {
  if (!await verifyResetPassword(password, account.passwordHash)) return false;
  return !resetPasswordNeedsUpgrade(account.passwordHash) || store.change(account.id, account.passwordHash, await hashResetPassword(password));
}
function newPassword(value: unknown): string {
  if (typeof value !== "string" || value.length < 12 || value.length > 1024)
    throw new PasswordResetError(400, "Use a password between 12 and 1,024 characters.");
  return value;
}

export type ResetOptions = {
  store: ResetStore;
  sender: ResetSender;
  /** Fixed public origin, never taken from a request header. HTTPS except local development. */
  origin: string;
  currentUser(request: Request): Promise<string | undefined>;
  now?: () => number;
};

export function createPasswordReset(options: ResetOptions) {
  const { store, sender } = options;
  const url = new URL(options.origin);
  if (url.origin !== options.origin || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))))
    throw new Error("A fixed public origin is required for password reset.");
  const now = options.now ?? Date.now;
  async function perform(request: Request, action: unknown, body: Record<string, unknown>) {
    const ip = clientIp(request);
    limitPublic("password-reset-ip", ip, 10, 15 * 60_000, now());
    if (action === "request" || action === "reset") {
      try { await verifyPublicBot(request, body.botCheckToken); }
      catch { throw new PasswordResetError(400, "Please complete the security check and try again."); }
    }
    if (action === "request") {
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        throw new PasswordResetError(400, "Enter a valid email address.");
      limitPublic("password-reset-email", emailLimitKey(email), 3, 15 * 60_000, now());
      // Both addresses take the same response path: no account lookup or delivery before answering.
      after(async () => {
        let key: string | undefined;
        try {
          const account = await store.find(email);
          if (!account) return;
          const token = randomBytes(32).toString("base64url");
          key = proofHash(token);
          await store.issue({ hash: key, userId: account.id, passwordHash: account.passwordHash, expiresAt: now() + RESET_LIFETIME_MS });
          const link = `${options.origin}/password-reset#token=${token}`;
          const outcome = await sender.send({ to: account.email, subject: "Reset your password", text: `Choose a new password using this link:\n${link}\n\nThis link expires in 30 minutes and can be used once. If you did not ask for it, you can ignore this email.` }, `password-reset-${key}`);
          if (outcome !== "accepted") {
            await store.revoke(key);
            console.warn("Password reset delivery.", { outcome, count: 1 });
          }
        } catch {
          if (key) { try { await store.revoke(key); } catch { /* No private error leaves this task. */ } }
          console.warn("Password reset delivery.", { outcome: "failed", count: 1 });
        }
      });
      return { message: RESET_ANSWER };
    }
    if (action === "reset") {
      const password = newPassword(body.password);
      if (typeof body.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(body.token))
        throw new PasswordResetError(400, "This link has expired or was already used. Request a new one.");
      if (!await store.redeem(proofHash(body.token), await hashResetPassword(password), now()))
        throw new PasswordResetError(400, "This link has expired or was already used. Request a new one.");
      return { message: "Your password has been changed. Sign in with your new password." };
    }
    if (action === "change") {
      const id = await options.currentUser(request);
      if (!id) throw new PasswordResetError(401, "Sign in to change your password.");
      limitPublic("password-change-account", id, 5, 15 * 60_000, now());
      const account = await store.findById(id);
      const current = typeof body.currentPassword === "string" && body.currentPassword.length <= 1024 ? body.currentPassword : "";
      if (!account || !await verifyResetPassword(current, account.passwordHash))
        throw new PasswordResetError(400, "Your current password is incorrect.");
      if (!await store.change(id, account.passwordHash, await hashResetPassword(newPassword(body.password))))
        throw new PasswordResetError(409, "Your account changed. Sign in again and retry.");
      return { message: "Your password has been changed. Sign in with your new password." };
    }
    throw new PasswordResetError(400, "Choose a password action.");
  }
  return {
    async handle(request: Request): Promise<Response> {
      const headers = { "cache-control": "no-store", "referrer-policy": "no-referrer" };
      try {
        if (request.method !== "POST") throw new PasswordResetError(405, "This action is not available.");
        if (request.headers.get("origin") !== options.origin) throw new PasswordResetError(403, "Refresh this page and try again.");
        if (!request.headers.get("content-type")?.startsWith("application/json")) throw new PasswordResetError(400, "Something in the form was not accepted. Refresh the page and try again.");
        const reader = request.body?.getReader();
        if (!reader) throw new PasswordResetError(400, "Something in the form was not accepted. Refresh the page and try again.");
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          for (;;) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.length;
            if (size > 4096) { await reader.cancel(); throw new PasswordResetError(413, "This request is too large."); }
            chunks.push(part.value);
          }
        } finally { reader.releaseLock(); }
        let body: Record<string, unknown>;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
        } catch { throw new PasswordResetError(400, "Something in the form was not accepted. Refresh the page and try again."); }
        return Response.json(await perform(request, body.action, body), { headers });
      } catch (error) {
        const status = error instanceof PasswordResetError ? error.status : (error as { status?: number })?.status === 429 ? 429 : 503;
        const message = error instanceof PasswordResetError ? error.message : status === 429 ? "Too many requests. Please try again later." : "Passwords are unavailable right now. Please try again later.";
        return Response.json({ message }, { status, headers });
      }
    },
  };
}
