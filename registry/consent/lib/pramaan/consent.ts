import "server-only";
import { PramaanError } from "@pramaan/sdk";
import { asViewer, capability, currentViewer, signedOut, transport, type Viewer } from "@/lib/pramaan/server";

// Server half of the consent block, on the messaging.opt-out superpowers: list, check, add and
// remove. Opt-outs are free and served by Pramaan itself. Every send through Pramaan is checked
// against them first, so an entry here stops that person being reached on that channel.

export type Channel = "sms" | "whatsapp" | "voice" | "email";
export type Scope = Channel | "all";
export type Source = "builder_api" | "inbound_stop" | "unsubscribe_link";

export interface Entry {
  readonly optOutId: string;
  readonly createdBy?: string;
  readonly removedBy?: string;
  readonly removedAt?: string;
  /** The start and end of the address, enough to recognise it. The rest isn't kept. */
  readonly addressHint: string;
  readonly channel: Scope;
  readonly source: Source;
  readonly reason?: string;
  readonly createdAt: string;
}

export interface Stop {
  readonly stopId: string;
  readonly addressHint: string;
  readonly sendingNumberHint: string;
  readonly channel: "sms" | "whatsapp";
  readonly createdAt: string;
}

export interface OptOutList {
  readonly results: Entry[];
  readonly nextCursor?: string;
  /** People who replied STOP to one of your numbers. Read-only. */
  readonly organisationStops?: Stop[];
  readonly viewer: Viewer;
}

const CHANNELS: readonly string[] = ["sms", "whatsapp", "voice", "email"];
const bad = (message: string, status = 400) => new PramaanError("invalid_request", message, { status });

async function signedIn(request: Request): Promise<Viewer> {
  const viewer = await currentViewer(request);
  if (!viewer.memberId) throw signedOut("Opt-outs can only be managed by someone who is signed in.");
  return viewer;
}

const address = (v: unknown) => {
  if (typeof v !== "string" || v.trim() === "" || v.length > 320) throw bad("Enter a phone number with its country code (like +14155550100) or an email address.");
  return v.trim();
};

function channelOf(v: unknown, allowAll: boolean): string {
  if (typeof v === "string" && (CHANNELS.includes(v) || (allowAll && v === "all"))) return v;
  throw bad(allowAll ? "Choose text messages, WhatsApp, calls, email or all." : "Choose text messages, WhatsApp, calls or email.");
}

export async function listOptOuts(request: Request, cursor: string | null, filters: { query?: string; channel?: string; source?: string; removed?: boolean } = {}): Promise<OptOutList> {
  const viewer = await signedIn(request);
  if (filters.query && filters.query.length > 200) throw bad("Search for up to 200 characters.");
  if (filters.channel) channelOf(filters.channel, true);
  if (filters.source && !["builder_api", "inbound_stop", "unsubscribe_link"].includes(filters.source)) throw bad("Choose how the opt-out was added.");
  const page = await capability<Omit<OptOutList, "viewer">>("messaging.opt-outs.list", { limit: 50, ...filters, ...(cursor ? { cursor } : {}) }, asViewer(viewer));
  return { ...page, viewer };
}

/** Whether a send to this address on this channel would be refused. Says blocked or not, never why. */
export async function checkOptOut(request: Request, a: string | null, channel: string | null) {
  await signedIn(request);
  return capability<{ blocked: boolean }>("messaging.opt-out.check", { address: address(a), channel: channelOf(channel, false) });
}

export async function addOptOut(request: Request, body: { address?: unknown; channel?: unknown; reason?: unknown }) {
  const viewer = await signedIn(request);
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 200) : "";
  return capability<Entry>("messaging.opt-out.add", { address: address(body.address), channel: channelOf(body.channel ?? "all", true), ...(reason ? { reason } : {}) }, asViewer(viewer));
}

/** Removal is held for approval; the service keeps the actor and removal history. */
export async function removeOptOut(request: Request, body: { optOutId?: unknown }) {
  const viewer = await signedIn(request);
  if (typeof body.optOutId !== "string" || !/^opt_[A-Za-z0-9_-]{1,128}$/.test(body.optOutId)) throw bad("Choose an entry from the list.");
  const res = await capability<{ removed?: number; status?: string }>("messaging.opt-out.remove", { optOutId: body.optOutId, confirm: true }, asViewer(viewer));
  return res.status === "running" ? { status: "waiting_for_approval" as const } : { status: "done" as const, removed: res.removed ?? 0 };
}

/** The signed recipient link names the address; browser-supplied addresses are never accepted. */
export async function unsubscribe(body: { link?: unknown }) {
  const t = transport();
  let link: URL;
  try { link = new URL(String(body.link)); } catch { throw bad("Use the unsubscribe link in your message."); }
  if (link.origin !== new URL(t.baseUrl).origin || !/^\/unsubscribe\/[A-Za-z0-9._~-]+$/.test(link.pathname) || link.search || link.hash)
    throw bad("Use the unsubscribe link in your message.");
  // No key goes with it; a redirect is refused, which fetch reports by throwing.
  const res = await t.fetch(link.href, { method: "POST", cache: "no-store", redirect: "error" }).catch(() => undefined);
  if (res?.status === 429) throw new PramaanError("rate_limited", "Too many tries. Wait a minute and try again.", { status: 429 });
  if (!res?.ok) throw bad("This link could not be used. Use the link in a more recent message.");
  return { ok: true as const };
}
