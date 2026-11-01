// Pure helpers for the dialler screen: number formatting, the timer, and recent calls worked out
// from a session's events. Safe in the browser; nothing here talks to Pramaan.

import type { PhoneEvent } from "./voice";

/** The letters printed under each key. */
export const LETTERS: Record<string, string> = { "2": "ABC", "3": "DEF", "4": "GHI", "5": "JKL", "6": "MNO", "7": "PQRS", "8": "TUV", "9": "WXYZ", "0": "+" };
export const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

/** Keeps digits, * and #, and a + only at the start. Typing or pasting any layout works. */
export const sanitizeNumber = (value: string) => value.replace(/[^\d+*#]/g, "").replace(/(?!^)\+/g, "");

// Groups of three, the last group up to four: 4155550100 reads 415 555 0100.
const groups = (digits: string) => {
  const out: string[] = [];
  let rest = digits;
  while (rest.length > 4) {
    out.push(rest.slice(0, 3));
    rest = rest.slice(3);
  }
  if (rest) out.push(rest);
  return out.join(" ");
};

/** A number as a person reads it: "+14155550100" is "+1 415 555 0100". */
export function formatNumber(raw: string): string {
  if (!raw.startsWith("+")) return groups(raw);
  const digits = raw.slice(1);
  const cc = /^[17]/.test(digits) ? 1 : 2; // Limit: one or two digit country codes only, add a table if a three digit one reads badly
  return `+${digits.slice(0, cc)}${digits.length > cc ? ` ${groups(digits.slice(cc))}` : ""}`;
}

/** Seconds as a clock: 7 is "0:07", 3725 is "1:02:05". */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mm = Math.floor(s / 60) % 60;
  const ss = String(s % 60).padStart(2, "0");
  return s >= 3600 ? `${Math.floor(s / 3600)}:${String(mm).padStart(2, "0")}:${ss}` : `${mm}:${ss}`;
}

export type CallPhase = "idle" | "calling" | "ringing" | "connected";
export interface CurrentCall {
  phase: CallPhase;
  callRef?: string;
  to?: string;
  /** When it connected, ms since 1970, for the timer. */
  connectedAt?: number;
}

/** Where the latest call stands, from the events in order. */
export function currentCall(events: PhoneEvent[]): CurrentCall {
  let c: CurrentCall = { phase: "idle" };
  for (const e of events) {
    if (e.type === "call.dialing") c = { phase: "calling", callRef: e.callRef, to: e.to };
    else if (e.type === "call.ringing") c = { ...c, phase: "ringing", callRef: e.callRef ?? c.callRef, to: e.to ?? c.to };
    else if (e.type === "call.connected") c = { ...c, phase: "connected", callRef: e.callRef ?? c.callRef, connectedAt: Date.parse(e.at) };
    else if (/^call\.(ended|failed|rejected)$/.test(e.type) || e.type.startsWith("session.")) c = { phase: "idle" };
  }
  return c;
}

export interface RecentCall {
  id: string;
  direction: "out" | "in";
  number: string;
  /** ISO time the call started. */
  at: string;
  /** Talk time in seconds, when it connected. */
  seconds?: number;
  outcome: string;
  /** True for a call that never connected. */
  missed: boolean;
}

const OUTCOME: Record<string, string> = { busy: "Busy", no_answer: "No answer", rejected: "Declined", failed: "Didn't connect" };

/** Calls that have finished, worked out from a session's events. */
export function finishedCalls(events: PhoneEvent[]): RecentCall[] {
  const open = new Map<string, { number: string; at: string; connectedAt?: number }>();
  const done: RecentCall[] = [];
  for (const e of events) {
    if (!e.callRef) continue;
    const c = open.get(e.callRef) ?? { number: e.to ?? "", at: e.at };
    if (e.to) c.number = e.to;
    if (e.type === "call.connected") c.connectedAt = Date.parse(e.at);
    open.set(e.callRef, c);
    if (!/^call\.(ended|failed|rejected)$/.test(e.type)) continue;
    const answered = c.connectedAt !== undefined;
    done.push({
      id: e.callRef,
      direction: "out",
      number: c.number,
      at: c.at,
      ...(answered ? { seconds: Math.max(0, (Date.parse(e.at) - c.connectedAt!) / 1000) } : {}),
      outcome: answered ? "Answered" : (e.reason && OUTCOME[e.reason]) || (e.type === "call.rejected" ? "Declined" : "Didn't connect"),
      missed: !answered,
    });
    open.delete(e.callRef);
  }
  return done;
}
