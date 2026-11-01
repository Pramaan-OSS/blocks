import "server-only";
import { PramaanError } from "@pramaan/sdk";
import { capability, currentViewer, signedOut, type Viewer } from "@/lib/pramaan/server";

// Server half of the consent block, on the messaging.opt-out superpowers: list, check, add and
// remove. Opt-outs are free and served by Pramaan itself. Every send through Pramaan is checked
// against them first, so an entry here stops that person being reached on that channel.

export type Channel = "sms" | "whatsapp" | "voice" | "email";
export type Scope = Channel | "all";
export type Source = "builder_api" | "inbound_stop" | "unsubscribe_link";

export interface Entry {
  readonly optOutId: string;
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

export async function listOptOuts(request: Request, cursor: string | null): Promise<OptOutList> {
  const viewer = await signedIn(request);
  const page = await capability<Omit<OptOutList, "viewer">>("messaging.opt-outs.list", { limit: 50, ...(cursor ? { cursor } : {}) });
  return { ...page, viewer };
}

/** Whether a send to this address on this channel would be refused. Says blocked or not, never why. */
export async function checkOptOut(request: Request, a: string | null, channel: string | null) {
  await signedIn(request);
  return capability<{ blocked: boolean }>("messaging.opt-out.check", { address: address(a), channel: channelOf(channel, false) });
}

export async function addOptOut(request: Request, body: { address?: unknown; channel?: unknown; reason?: unknown }) {
  await signedIn(request);
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 200) : "";
  return capability<Entry>("messaging.opt-out.add", { address: address(body.address), channel: channelOf(body.channel ?? "all", true), ...(reason ? { reason } : {}) });
}

// Limit: removals are logged to the server console. The API has no audit field on remove;
// send this line to your own audit log.
const audit = (line: Record<string, unknown>) => console.info(JSON.stringify({ event: "opt_out_removed", ...line }));

/**
 * Lets a person be messaged again. Only an approver may: it undoes someone's wish not to be
 * contacted. The API's remove call needs the whole address (the list shows only a hint) and takes
 * away only entries the project added; a person's own STOP or unsubscribe stays.
 */
export async function removeOptOut(request: Request, body: { address?: unknown; channel?: unknown }) {
  const viewer = await signedIn(request);
  if (!viewer.canApprove) throw new PramaanError("forbidden", "Only an approver can let someone be messaged again. Ask an approver in your workspace.", { status: 403 });
  const a = address(body.address);
  const channel = body.channel === undefined ? undefined : channelOf(body.channel, true);
  const res = await capability<{ removed: number }>("messaging.opt-out.remove", { address: a, ...(channel ? { channel } : {}), confirm: true });
  audit({ by: viewer.memberId, channel: channel ?? "every channel", removed: res.removed, at: new Date().toISOString() });
  return res;
}

/**
 * The public stop page: anyone can unsubscribe their own address. The answer never says whether it
 * was already listed, so the page can't be used to find out who is a contact. Add your own rate
 * limit in front of this route.
 */
export async function unsubscribe(body: { address?: unknown; channel?: unknown }) {
  await capability<Entry>("messaging.opt-out.add", { address: address(body.address), channel: channelOf(body.channel ?? "all", true), reason: "Unsubscribed on your website" });
  return { ok: true as const };
}
