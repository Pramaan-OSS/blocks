import "server-only";
import { PramaanError } from "@pramaan/sdk";
import { capability, pramaan } from "@/lib/pramaan/server";
import { emailLimitKey, limitPublic, verifyBookingBot } from "@/lib/pramaan/public-guard";

// Server half of the booking block: offers the open times on the host's own connected calendar
// (Google or Outlook) and books one. Calls apps.connections.list, calendar.free-busy.get and
// calendar.event.create. Visitors see only open times, never what is on the calendar.

/** Edit this: when you can be booked. */
export const BOOKING = {
  /** What the meeting is called. The visitor's name is added: "Meeting with Sam". */
  title: "Meeting",
  slotMinutes: 30,
  /** First start and last end, in the time zone below. */
  hours: [9, 17] as readonly [number, number],
  /** 0 is Sunday. */
  weekdays: [1, 2, 3, 4, 5],
  /** An IANA time zone, like "America/New_York". */
  timezone: "UTC",
  /** How many days ahead are offered. */
  daysAhead: 14,
  /** No booking sooner than this from now. */
  minNoticeMinutes: 60,
  /** Calendar apps tried, in order. */
  apps: ["googlecalendar", "outlook"],
};

export type Availability =
  | { state: "ready"; title: string; timezone: string; slotMinutes: number; slots: { start: string; end: string }[] }
  | { state: "needs_connection"; reason: "not_connected" | "needs_reconnect" };

export type Booked = { status: "booked"; start: string; end: string } | { status: "requested"; start: string; end: string };

const bad = (message: string, status = 400) => new PramaanError("invalid_request", message, { status });
const MIN = 60_000;
const DAY = 86_400_000;

/** How far a time zone is ahead of UTC at an instant, in ms. */
function offsetMs(at: number, timeZone: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" })
      .formatToParts(new Date(at))
      .map((x) => [x.type, Number(x.value)]),
  );
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(at / 1000) * 1000;
}

/** The UTC instant of a wall-clock time in a time zone (a daylight-saving gap lands just after it). */
export function zonedToUtc(y: number, m: number, d: number, h: number, min: number, timeZone: string): number {
  const guess = Date.UTC(y, m - 1, d, h, min);
  const first = guess - offsetMs(guess, timeZone);
  return guess - offsetMs(first, timeZone);
}

/** Every start time on offer from a date (YYYY-MM-DD), before checking the calendar. */
export function candidateSlots(from: string, days: number, now: number): number[] {
  const [y, m, d] = from.split("-").map(Number);
  const out: number[] = [];
  const { hours, slotMinutes, weekdays, timezone, minNoticeMinutes } = BOOKING;
  for (let i = 0; i < days; i++) {
    const day = new Date(Date.UTC(y, m - 1, d + i));
    if (!weekdays.includes(day.getUTCDay())) continue;
    for (let minute = hours[0] * 60; minute + slotMinutes <= hours[1] * 60; minute += slotMinutes) {
      const at = zonedToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), Math.floor(minute / 60), minute % 60, timezone);
      // Reject nonexistent wall-clock times on the spring daylight-saving change.
      const wall = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).format(at);
      if (wall !== `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`) continue;
      if (at >= now && at >= now + minNoticeMinutes * MIN && at <= now + BOOKING.daysAhead * DAY) out.push(at);
    }
  }
  return out;
}

export function bookingHost(): string {
  const ref = process.env.PRAMAAN_BOOKING_HOST?.trim();
  if (!ref) throw new PramaanError("connection_required", "Booking isn't set up yet. Ask the owner to choose a calendar for bookings.", { status: 503 });
  return ref;
}

// Limit: holds and cache are per server instance; several instances need a shared store.
type Hold = { until: number; key?: string; result?: Booked; jobId?: string; checkedAt?: number };
const holds = new Map<string, Hold>();
const busyCache = new Map<string, { until: number; value: Promise<[number, number][]> }>();
export function resetBookingState() { holds.clear(); busyCache.clear(); }
const holdKey = (host: string, at: number) => `${host}:${at}`;
async function pruneHolds(host: string) {
  const now = Date.now();
  await Promise.all([...holds].map(async ([key, hold]) => {
    if (hold.until <= now) { holds.delete(key); return; }
    if (!key.startsWith(`${host}:`) || !hold.jobId || (hold.checkedAt !== undefined && now - hold.checkedAt < 30_000)) return;
    hold.checkedAt = now;
    try {
      const job = await pramaan<{ status?: string; approval?: { status?: string } }>(`/v1/jobs/${encodeURIComponent(hold.jobId)}`);
      if (holds.get(key) !== hold) return;
      if (["denied", "expired", "cancelled"].includes(job.approval?.status ?? "") || job.status === "cancelled" || job.status === "failed") {
        holds.delete(key);
        busyCache.clear();
      } else if (job.approval?.status === "approved") {
        hold.jobId = undefined; // Keep the hold through the slot even if the calendar list is delayed.
      }
    } catch {
      // An unavailable approval status is never permission to offer the slot again.
      console.warn("A booking approval could not be checked. Its time is still held.");
    }
  }));
}
const taken = () => new PramaanError("conflict", "That time was just taken. Pick another.", { status: 409 });
export function bookingSetting(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1) throw new PramaanError("connection_required", "Booking isn't set up correctly. Ask the owner to check its settings.", { status: 503 });
  return value;
}

/** The host's connected calendar app, or why there isn't one. */
async function calendarApp(endUserRef: string): Promise<{ app: string } | { reason: "not_connected" | "needs_reconnect" }> {
  const { results } = await capability<{ results: { app: string; status: string }[] }>("apps.connections.list", { endUserRef });
  const mine = results.filter((r) => BOOKING.apps.includes(r.app));
  const live = mine.find((r) => r.status === "active");
  return live ? { app: live.app } : { reason: mine.some((r) => r.status !== "revoked") ? "needs_reconnect" : "not_connected" };
}

async function busyIntervals(endUserRef: string, app: string, after: number, before: number, cached = false): Promise<[number, number][]> {
  const key = JSON.stringify([endUserRef, app, after, before]);
  for (const [k, row] of busyCache) if (row.until <= Date.now()) busyCache.delete(k);
  const existing = busyCache.get(key);
  if (cached && existing) return existing.value;
  const value = readBusy(endUserRef, app, after, before);
  if (cached) busyCache.set(key, { until: Date.now() + 60_000, value });
  try { return await value; } catch (error) { if (busyCache.get(key)?.value === value) busyCache.delete(key); throw error; }
}
async function readBusy(endUserRef: string, app: string, after: number, before: number): Promise<[number, number][]> {
  const res = await capability<{ results: { busy: { start: string; end: string }[] }[] }>("calendar.free-busy.get", {
    calendars: [{ endUserRef, app }],
    timezone: BOOKING.timezone,
    after: new Date(after).toISOString(),
    before: new Date(before).toISOString(),
  });
  return (res.results[0]?.busy ?? []).map((b) => [Date.parse(b.start), Date.parse(b.end)]);
}

const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

/** Open times from a date. Nothing about the calendar's contents goes out. */
export async function availability(request: Request, query: { from?: string | null; days?: string | null }): Promise<Availability> {
  const now = Date.now();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: BOOKING.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const from = query.from ?? today;
  if (!isDate(from)) throw bad("Choose a date like 2026-10-15.");
  const day0 = Date.parse(`${from}T00:00:00Z`);
  const today0 = Date.parse(`${today}T00:00:00Z`);
  if (day0 < today0 - DAY || day0 > today0 + BOOKING.daysAhead * DAY) throw bad("Choose a date within the booking window.");
  const days = query.days == null ? BOOKING.daysAhead : Number(query.days);
  if (!Number.isInteger(days) || days < 1 || days > 31) throw bad("Choose from 1 to 31 days.");
  const endUserRef = bookingHost();
  const candidates = candidateSlots(from, days, now);
  const ready = { state: "ready" as const, title: BOOKING.title, timezone: BOOKING.timezone, slotMinutes: BOOKING.slotMinutes };
  if (!candidates.length) return { ...ready, slots: [] };
  const found = await calendarApp(endUserRef);
  if ("reason" in found) return { state: "needs_connection", reason: found.reason };
  await pruneHolds(endUserRef);
  const busy = await busyIntervals(endUserRef, found.app, day0 - DAY, day0 + (days + 1) * DAY, true);
  const { slotMinutes } = BOOKING;
  const slots = candidates
    .filter((at) => !holds.has(holdKey(endUserRef, at)))
    .filter((at) => !busy.some(([s, e]) => s < at + slotMinutes * MIN && e > at))
    .map((at) => ({ start: new Date(at).toISOString(), end: new Date(at + slotMinutes * MIN).toISOString() }));
  return { state: "ready", title: BOOKING.title, timezone: BOOKING.timezone, slotMinutes, slots };
}

/**
 * Books one open time. The time must be one the host offers (so a visitor can't pick 3am or their own
 * length), and is checked against the calendar again just before it is made. Making an event sends an
 * invitation, which is irreversible: with an API key it waits for a member's yes (202), and the answer
 * is then `requested`.
 */
export async function book(request: Request, body: { start?: unknown; name?: unknown; email?: unknown; notes?: unknown; botCheckToken?: unknown }): Promise<Booked> {
  const at = typeof body.start === "string" ? Date.parse(body.start) : NaN;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";
  if (Number.isNaN(at)) throw bad("Pick a time first.");
  if (name === "" || name.length > 100) throw bad("Enter your name (up to 100 characters).");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw bad("That email address doesn't look right.");
  if (notes.length > 500) throw bad("Keep the note under 500 characters.");
  const now = Date.now();
  if (at < now || at > now + BOOKING.daysAhead * DAY) throw bad("That time is too early or too far ahead. Pick another.");
  const day = new Date(at - DAY).toISOString().slice(0, 10);
  if (!candidateSlots(day, 3, Date.now()).includes(at)) throw bad("That time isn't one of the open times. Pick another.");
  const endUserRef = bookingHost();
  await verifyBookingBot(request, body.botCheckToken);
  limitPublic("booking-email", emailLimitKey(email), bookingSetting("PRAMAAN_BOOKING_EMAIL_LIMIT", 5), 3_600_000);
  await pruneHolds(endUserRef);
  const reservation = holdKey(endUserRef, at);
  const key = request.headers.get("idempotency-key") ?? undefined;
  const held = holds.get(reservation);
  if (held) {
    if (key && held.key === key && held.result) return held.result;
    throw taken();
  }
  const end = at + BOOKING.slotMinutes * MIN;
  const hold: Hold = { until: end, key };
  let created = false;
  let removed = false;
  let conflict: { start: string; end: string; savedEventRef: string; competingEventRef: string } | undefined;
  holds.set(reservation, hold);
  try {
    const found = await calendarApp(endUserRef);
    if ("reason" in found) throw new PramaanError("connection_required", "This calendar isn't connected right now.", { status: 503, next: "Ask the owner to reconnect it, then try again." });
    if ((await busyIntervals(endUserRef, found.app, at, end)).length > 0) throw new PramaanError("conflict", "That time was just taken. Pick another.", { status: 409 });
    // Count attempts at creation, including pending approvals, to bound invitation traffic.
    limitPublic("booking-day", `${endUserRef}:${new Date(now).toISOString().slice(0, 10)}`, bookingSetting("PRAMAAN_BOOKING_DAILY_LIMIT", 50), Date.parse(`${new Date(now + DAY).toISOString().slice(0, 10)}T00:00:00Z`) - now);
    const res = await capability<{ status?: string; ref?: string; job_id?: string }>(
      "calendar.event.create",
      {
        endUserRef,
        app: found.app,
        title: `${BOOKING.title} with ${name}`,
        start: new Date(at).toISOString().slice(0, 19),
        end: new Date(end).toISOString().slice(0, 19),
        timezone: "UTC",
        ...(notes ? { description: notes } : {}),
        attendees: [{ email, name }],
        sendInvites: true,
      },
      key ? { "Idempotency-Key": key } : undefined,
    );
    const when = { start: new Date(at).toISOString(), end: new Date(end).toISOString() };
    created = !!res.ref || res.status === "running";
    if (!created) throw new Error("Booking creation returned no event reference.");
    busyCache.clear();
    hold.result = { status: res.status === "running" ? "requested" : "booked", ...when };
    if (res.status === "running") {
      hold.jobId = res.job_id;
    } else {
      // A winner looks again after a short delay to catch an earlier create that was slow to appear.
      for (let check = 0; check < 2; check++) {
        if (check) await delay(1000);
        const events = await bookingEvents(endUserRef, found.app, when.start, when.end, res.ref!);
        const overlaps = events.filter((e) => competingEvent(e) && Date.parse(e.startAt ?? "") < end && Date.parse(e.endAt ?? "") > at);
        if (!overlaps.some((e) => e.ref === res.ref) || overlaps.some((e) => !Number.isFinite(Date.parse(e.createdAt ?? "")))) throw new Error("Booking conflict check is incomplete.");
        overlaps.sort((a, b) => Date.parse(a.createdAt!) - Date.parse(b.createdAt!) || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
        if (overlaps[0].ref !== res.ref) {
          conflict = { start: when.start, end: when.end, savedEventRef: res.ref!, competingEventRef: overlaps[0].ref };
          const result = await capability<{ deleted?: boolean }>("calendar.event.delete", { endUserRef, app: found.app, ref: res.ref, sendInvites: true });
          if (result.deleted !== true) throw new Error("Booking conflict cleanup is waiting or incomplete.");
          removed = true;
          hold.key = undefined;
          hold.result = undefined;
          throw taken();
        }
      }
    }
    return hold.result!;
  } catch (error) {
    if (!created) {
      holds.delete(reservation);
      throw error;
    }
    if (removed) throw error;
    // The event (or pending request) exists: never invite another visitor into its slot on a read failure.
    if (conflict) {
      console.warn("Two bookings overlap and cleanup could not finish. Check the calendar; its time is still held.", conflict);
    } else {
      console.warn("A booking was saved, but its conflict check could not finish. Check the calendar; its time is still held.", { start: hold.result!.start, end: hold.result!.end });
    }
    return hold.result!;
  }
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Retry transient listing failures and calendar visibility lag, keeping every page of the winning attempt. */
async function bookingEvents(host: string, app: string, start: string, end: string, ref: string): Promise<CalendarEvent[]> {
  for (let attempt = 0; ; attempt++) {
    try {
      const events: CalendarEvent[] = [];
      let cursor: string | undefined;
      do {
        const page: { results: CalendarEvent[]; nextCursor?: string } = await capability("calendar.events.list", {
          endUserRef: host, app, after: start, before: end, limit: 50, ...(cursor ? { cursor } : {}),
        });
        events.push(...page.results);
        cursor = page.nextCursor;
      } while (cursor);
      if (!events.some((e) => e.ref === ref)) throw new Error("Booking is not visible in the calendar yet.");
      return events;
    } catch (error) {
      if (attempt === 2) throw error;
      await delay(250);
    }
  }
}

function competingEvent(event: CalendarEvent): boolean {
  return !event.allDay && event.status !== "cancelled" && event.status !== "declined" && event.responseStatus !== "declined"
    && event.transparency !== "free" && event.transparency !== "transparent";
}

type CalendarEvent = { ref: string; createdAt?: string; startAt?: string; endAt?: string; status?: string; allDay?: boolean; responseStatus?: string; transparency?: string };
