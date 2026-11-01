import "server-only";
import { PramaanError } from "@pramaan/sdk";
import { capability, signedOut } from "@/lib/pramaan/server";
import { currentEndUserRef } from "@/lib/pramaan/session";

// Server half of the voice call block: opens a browser phone session for the signed-in person,
// places and ends calls, and reads the call events. The page gets a short-lived phone credential,
// never your API key. Calls voice.browser-session.create / .events / .close,
// voice.browser-call.start and voice.call.end.

export interface PhoneSession {
  /** An opaque handle for the session. Keep it in the page; never show it. */
  readonly ref: string;
  readonly connectUrl: string;
  /** Short-lived. Only the page that opened the session should hold it. */
  readonly credential: string;
  readonly expiresAt: string;
  /** The number calls come from, E.164. */
  readonly number: string;
  /** True when the demo fake is on: the page shows a marked stand-in instead of using the microphone. */
  readonly standIn: boolean;
}

export interface PhoneEvent {
  readonly id: string;
  readonly type: string;
  readonly at: string;
  readonly callRef?: string;
  readonly from?: string;
  readonly to?: string;
  readonly reason?: string;
}

const bad = (message: string) => new PramaanError("invalid_request", message, { status: 400 });
const REF = /^ref_[A-Za-z0-9_-]{3,120}$/;
const NUMBER = /^\+[1-9]\d{6,14}$/;

const refOf = (value: unknown) => {
  if (typeof value !== "string" || !REF.test(value)) throw bad("That phone session or call couldn't be found. Open the phone again.");
  return value;
};

async function agent(request: Request): Promise<string> {
  const ref = await currentEndUserRef(request);
  if (!ref) throw signedOut("You need to be signed in to make calls.");
  return ref;
}

/** The app's own address: the phone only connects from this exact origin. Set APP_URL behind a proxy. */
const originOf = (request: Request) => (process.env.APP_URL || new URL(request.url).origin).replace(/\/$/, "");

/** The numbers calls can go out from: PRAMAAN_VOICE_NUMBERS (comma separated) or PRAMAAN_VOICE_NUMBER. */
function numbersOf(): string[] {
  const list = (process.env.PRAMAAN_VOICE_NUMBERS ?? process.env.PRAMAAN_VOICE_NUMBER ?? "").split(",").map((n) => n.trim()).filter(Boolean);
  if (list.length === 0 && process.env.PRAMAAN_FAKE === "1") return ["+14155550100", "+442071838750"];
  if (list.length === 0)
    throw new PramaanError("connection_required", "No phone number is set up for calls yet.", {
      status: 503,
      next: "Set PRAMAAN_VOICE_NUMBER to one of your numbers, then restart the app.",
    });
  return list;
}

/** What the dialler needs before anything is opened: the lines to call from, and whether this is the demo. */
export async function lines(request: Request): Promise<{ numbers: string[]; standIn: boolean }> {
  await agent(request);
  return { numbers: numbersOf(), standIn: process.env.PRAMAAN_FAKE === "1" };
}

export async function openSession(request: Request, body: { from?: unknown } = {}): Promise<PhoneSession> {
  const who = await agent(request);
  const fake = process.env.PRAMAAN_FAKE === "1";
  const numbers = numbersOf();
  const from = typeof body.from === "string" && body.from ? body.from : numbers[0];
  if (!numbers.includes(from)) throw bad("Choose one of your numbers from the list.");
  const key = request.headers.get("idempotency-key") ?? undefined;
  const s = await capability<Omit<PhoneSession, "standIn"> & { ref?: string }>(
    "voice.browser-session.create",
    { agent: who, from, origin: originOf(request) },
    key ? { "Idempotency-Key": key } : undefined,
  );
  if (!s.ref) throw new PramaanError("internal", "The phone session didn't come back. Try again.", { status: 502 });
  return { ref: s.ref, connectUrl: s.connectUrl, credential: s.credential, expiresAt: s.expiresAt, number: s.number, standIn: fake };
}

/**
 * Dials a number. An outbound call is irreversible, so with an API key it waits for a member's yes
 * in the approvals inbox (202): the answer is then `waiting_for_approval` and the call's events
 * arrive once it is approved.
 */
export async function placeCall(request: Request, body: { ref?: unknown; to?: unknown }) {
  await agent(request);
  const ref = refOf(body.ref);
  const to = typeof body.to === "string" ? body.to.replace(/[\s()-]/g, "") : "";
  if (!NUMBER.test(to)) throw bad("Enter the phone number with its country code, like +1 415 555 0100.");
  const key = request.headers.get("idempotency-key") ?? undefined;
  const res = await capability<{ callRef?: string; state?: string; status?: string }>("voice.browser-call.start", { ref, to }, key ? { "Idempotency-Key": key } : undefined);
  return res.status === "running" || !res.callRef ? { status: "waiting_for_approval" as const } : { status: "calling" as const, callRef: res.callRef };
}

export async function readEvents(request: Request, ref: unknown, cursor: string | null): Promise<{ events: PhoneEvent[] }> {
  await agent(request);
  if (cursor !== null && !/^ve_\d{1,9}$/.test(cursor)) throw bad("That cursor isn't valid.");
  const res = await capability<{ events: PhoneEvent[] }>("voice.browser-session.events", { ref: refOf(ref), ...(cursor ? { cursor } : {}) });
  return { events: res.events };
}

export async function endCall(request: Request, body: { callRef?: unknown }) {
  await agent(request);
  await capability("voice.call.end", { ref: refOf(body.callRef) });
  return { status: "ended" as const };
}

export async function closeSession(request: Request, body: { ref?: unknown }) {
  await agent(request);
  await capability("voice.browser-session.close", { ref: refOf(body.ref) });
  return { status: "closed" as const };
}
