import "server-only";
import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { PramaanError, type Requests, type Results } from "@pramaan/sdk";
import { capability } from "./server";

// Limit: counters are per server instance. Move to a shared store when running several instances.
let lastPrune = -Infinity;
const runtime = globalThis as typeof globalThis & { __pramaanIpWarningShown?: boolean };
const counters = new Map<string, { count: number; until: number }>();
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export const PUBLIC_READ_LIMIT = 60;
export const PUBLIC_WRITE_LIMIT = 10;
export const PUBLIC_WINDOW_MS = 60_000;
export const NO_IP_LIMIT_MULTIPLIER = 10;

/** A startup reminder, also used by consumers without an instrumentation hook. */
export function warnPublicIpSetup() {
  if (runtime.__pramaanIpWarningShown) return;
  runtime.__pramaanIpWarningShown = true;
  console.warn("Public route IP limits need a trusted proxy header. Without one, visitors share a higher request limit. Configure the proxy before publishing.");
}
export function resetPublicLimits() { counters.clear(); lastPrune = -Infinity; }

/** Trust x-real-ip only by explicit setting; otherwise count trusted proxy hops from the right. */
export function clientIp(request: Request): string | undefined {
  const real = request.headers.get("x-real-ip")?.trim();
  if (process.env.PRAMAAN_TRUSTED_IP_HEADER === "x-real-ip" && real && isIP(real)) return real;
  const hops = Number(process.env.PRAMAAN_TRUSTED_PROXY_HOPS ?? 1);
  if (!Number.isInteger(hops) || hops < 1) throw new PramaanError("connection_required", "Ask the owner to check this app's connection settings.", { status: 503 });
  const parts = request.headers.get("x-forwarded-for")?.split(",").map((part) => part.trim());
  const selected = parts?.[parts.length - hops];
  return selected && isIP(selected) ? selected : undefined;
}

/** Counts synchronously. Missing IPs share a separate bucket at ten times the normal IP limit. */
export function limitPublic(scope: string, identity: string | undefined, max: number, windowMs: number, now = Date.now()) {
  if (!identity) {
    identity = "no-ip";
    max *= NO_IP_LIMIT_MULTIPLIER;
    warnPublicIpSetup();
  }
  if (now - lastPrune >= 1000) {
    for (const [key, row] of counters) if (row.until <= now) counters.delete(key);
    lastPrune = now;
  }
  const key = `${scope}:${digest(identity)}`;
  const existing = counters.get(key);
  // An individual expired bucket resets even between full-map cleanups.
  const row = existing && existing.until > now ? existing : { count: 0, until: now + windowMs };
  if (row.count >= max) throw new PramaanError("rate_limited", "Too many requests. Please try again later.", { status: 429 });
  row.count++;
  counters.set(key, row);
}

/** Use a mailbox, rather than its plus aliases, as the quota identity. Invitations keep the original address. */
export function emailLimitKey(email: string): string {
  const [local, domain] = email.trim().toLowerCase().split("@");
  const base = local.split("+")[0];
  return domain === "gmail.com" || domain === "googlemail.com" ? `${base.replaceAll(".", "")}@gmail.com` : `${base}@${domain}`;
}

/** Optional server-side verification. No network call at all when disabled. */
export async function verifyPublicBot(request: Request, token: unknown) {
  const secret = process.env.PRAMAAN_BOT_CHECK_SECRET;
  if (!secret) return;
  const refusal = () => new PramaanError("invalid_request", "Please complete the security check and try again.", { status: 400 });
  if (typeof token !== "string" || !token || token.length > 2048) throw refusal();
  const ip = clientIp(request);
  const input: Requests["auth.bot-check.verify"] = { token, ...(ip ? { remoteIp: ip } : {}) };
  try {
    const result = await capability<Results["auth.bot-check.verify"]>("auth.bot-check.verify", input);
    if (result?.passed !== true) throw refusal();
  } catch { throw refusal(); }
}

/** Kept for existing booking installs. */
export const verifyBookingBot = verifyPublicBot;
