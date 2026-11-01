import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BOOKING, availability, book, candidateSlots, resetBookingState, zonedToUtc } from "@/lib/pramaan/booking";
import { resetPublicLimits, limitPublic, verifyBookingBot } from "@/lib/pramaan/public-guard";
import { failNext, fakeState, resetFake } from "@/lib/pramaan/fake";
import { calendar } from "@/lib/pramaan/fake-wave3";
import { platform } from "@/lib/pramaan/fake-platform";
import { capability } from "@/lib/pramaan/server";
import * as server from "@/lib/pramaan/server";
import { callRoute, get, post, useClock } from "./harness";
import { register } from "../registry/booking/instrumentation";

const original = structuredClone(BOOKING);
const request = (ip = "192.0.2.1") => new Request("http://app.test/api/pramaan/booking", { headers: { "x-forwarded-for": ip } });
const visitor = { name: "Sam", email: "sam@example.com" };
const sent = (id: string) => fakeState().requests.filter((r) => r.path === `/v1/capabilities/${id}`);
const connect = (user = "user-42") => { platform(fakeState()).connections.get(user)!.find((x) => x.app === "googlecalendar")!.status = "active"; };
const open = async (r = request()) => {
  const result = await availability(r, {});
  if (result.state !== "ready") throw new Error("Missing calendar");
  return result.slots;
};

beforeEach(() => {
  resetFake();
  useClock(fakeState(), 0);
  connect();
});
afterEach(() => {
  Object.assign(BOOKING, structuredClone(original));
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("booking protections", () => {
  it("fails both public routes without a host, even for a signed-in visitor, and warns on startup", async () => {
    vi.stubEnv("PRAMAAN_BOOKING_HOST", "");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    await register();
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("PRAMAAN_BOOKING_HOST"));
    for (const result of [await get(undefined, "/api/pramaan/booking"), await post(undefined, "/api/pramaan/booking", {}, { "x-forwarded-for": "192.0.2.1" })]) {
      expect(result.status).toBe(503);
      expect(JSON.stringify(await result.json())).toContain("choose a calendar");
    }
    expect(fakeState().requests).toHaveLength(0);
  });

  it("offers and accepts the horizon boundary but refuses past and later slots before calendar calls", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-02T09:00:00Z"));
    BOOKING.minNoticeMinutes = 0;
    const edge = "2026-11-16T09:00:00Z";
    expect(candidateSlots("2026-11-16", 1, Date.now())).toEqual([Date.parse(edge)]);
    for (const start of ["2026-11-02T08:30:00Z", "2026-11-16T09:30:00Z"]) {
      await expect(book(request(), { ...visitor, start })).rejects.toMatchObject({ status: 400, message: "That time is too early or too far ahead. Pick another." });
    }
    expect(sent("calendar.free-busy.get")).toHaveLength(0);
    await expect(book(request(), { ...visitor, start: edge })).resolves.toMatchObject({ status: "requested" });
  });

  it.each(["Pacific/Kiritimati", "Pacific/Pago_Pago"])("offers and books correct wall-clock slots in %s", async (zone) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-01T00:00:00Z"));
    BOOKING.timezone = zone;
    const candidates = candidateSlots("2026-11-02", 1, Date.now());
    expect(candidates).toHaveLength(16);
    for (const at of candidates) {
      const local = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hourCycle: "h23", hour: "2-digit", minute: "2-digit", weekday: "long" }).format(at);
      expect(local).toContain("Monday");
      expect(Number(local.match(/(\d{2}):/)![1])).toBeGreaterThanOrEqual(9);
      expect(Number(local.match(/(\d{2}):/)![1])).toBeLessThan(17);
    }
    await expect(book(request(), { ...visitor, start: new Date(candidates[0]).toISOString() })).resolves.toMatchObject({ status: "requested" });
  });

  it.each([
    ["2026-03-08", "2026-03-01T00:00:00Z", 13],
    ["2026-11-01", "2026-10-25T00:00:00Z", 14],
  ] as const)("skips missing clock times and duplicates on the daylight-saving day %s", (day, now, firstHour) => {
    BOOKING.timezone = "America/New_York";
    BOOKING.weekdays = [0];
    const slots = candidateSlots(day, 1, Date.parse(now));
    expect(slots).toHaveLength(16);
    expect(new Date(slots[0]).getUTCHours()).toBe(firstHour);
    expect(new Set(slots).size).toBe(slots.length);
    BOOKING.hours = [0, 4];
    const early = candidateSlots(day, 1, Date.parse(now));
    expect(new Set(early).size).toBe(early.length);
    const labels = early.map((t) => new Intl.DateTimeFormat("en-GB", { timeZone: BOOKING.timezone, hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).format(t));
    expect(new Set(labels).size).toBe(labels.length);
    expect(early.length).toBe(day.includes("03-08") ? 6 : 8);
    expect(zonedToUtc(2026, 3, 9, 9, 0, BOOKING.timezone)).toBe(Date.parse("2026-03-09T13:00:00Z"));
  });

  it("allows exactly one of two concurrent requests for a slot", async () => {
    const [slot] = await open();
    calendar(fakeState()).immediate = true;
    const results = await Promise.all([post(undefined, "/api/pramaan/booking", { ...visitor, start: slot.start }), post(undefined, "/api/pramaan/booking", { ...visitor, email: "other@example.com", start: slot.start })]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(calendar(fakeState()).events).toHaveLength(1);
    expect(sent("calendar.event.create")).toHaveLength(1);
    expect(sent("calendar.events.list")).toHaveLength(2);
    expect((await open()).map((s) => s.start)).not.toContain(slot.start);
  });

  it("keeps the earliest event across two server instances; reference breaks a creation-time tie", async () => {
    const [slot] = await open();
    calendar(fakeState()).immediate = true;
    // Separate module state models independent server-process holds; both use the same fake calendar.
    vi.resetModules();
    const other = await import("@/lib/pramaan/booking");
    const results = await Promise.allSettled([
      book(request(), { ...visitor, start: slot.start }),
      other.book(request("192.0.2.2"), { ...visitor, email: "other@example.com", start: slot.start }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ status: 409 });
    expect(sent("calendar.event.create")).toHaveLength(2);
    expect(sent("calendar.event.delete")).toHaveLength(1);
    expect(calendar(fakeState()).events).toHaveLength(1);
    const deleted = sent("calendar.event.delete")[0].body as { ref: string };
    expect(calendar(fakeState()).events[0].ref < deleted.ref).toBe(true);
  });

  it("uses creation time before reference when resolving a conflict", async () => {
    const [slot] = await open();
    calendar(fakeState()).immediate = true;
    const real = server.capability;
    vi.spyOn(server, "capability").mockImplementation(async (id, input, headers) => {
      if (id === "calendar.events.list") {
        const ours = calendar(fakeState()).events[0];
        calendar(fakeState()).events.push({ ...ours, ref: "ref_zzzz", createdAt: new Date(Date.parse(ours.createdAt!) - 1000).toISOString() });
      }
      return real(id, input, headers);
    });
    await expect(book(request(), { ...visitor, start: slot.start })).rejects.toMatchObject({ status: 409 });
    expect(calendar(fakeState()).events.map((e) => e.ref)).toEqual(["ref_zzzz"]);
  });

  it("the daily booking cap resets at UTC midnight", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-01T23:59:59Z"));
    vi.stubEnv("PRAMAAN_BOOKING_DAILY_LIMIT", "1");
    const slots = await open();
    await book(request(), { ...visitor, start: slots[0].start });
    await expect(book(request(), { ...visitor, email: "other@example.com", start: slots[1].start })).rejects.toMatchObject({ status: 429 });
    vi.advanceTimersByTime(1001);
    await expect(book(request(), { ...visitor, email: "other@example.com", start: slots[1].start })).resolves.toMatchObject({ status: "requested" });
    expect(sent("calendar.event.create")).toHaveLength(2);
  });

  it("releases failed holds and keeps pending holds until the slot ends", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-02T07:00:00Z"));
    const [slot] = await open();
    failNext("POST", "/v1/capabilities/calendar.event.create", 503, { code: "internal", message: "Try again later." });
    await expect(book(request(), { ...visitor, start: slot.start })).rejects.toMatchObject({ status: 503 });
    expect((await open()).map((s) => s.start)).toContain(slot.start);
    await book(request(), { ...visitor, start: slot.start });
    expect((await open()).map((s) => s.start)).not.toContain(slot.start);
    vi.advanceTimersByTime(16 * 60_000);
    expect((await open()).map((s) => s.start)).not.toContain(slot.start);
  });

  it("limits POST by IP before paid calls and GET separately", async () => {
    vi.stubEnv("PRAMAAN_BOOKING_IP_LIMIT", "2");
    for (let i = 0; i < 2; i++) expect((await post(undefined, "/api/pramaan/booking", {}, { "x-forwarded-for": "192.0.2.1" })).status).toBe(400);
    expect((await post(undefined, "/api/pramaan/booking", {}, { "x-forwarded-for": "192.0.2.1" })).status).toBe(429);
    expect(fakeState().requests).toHaveLength(0);
    vi.stubEnv("PRAMAAN_BOOKING_GET_LIMIT", "1");
    expect((await callRoute(request())).status).toBe(200);
    expect((await callRoute(request())).status).toBe(429);
    expect(sent("calendar.free-busy.get")).toHaveLength(1);
  });

  it("normalizes email limits across IPs and caps all booking attempts per UTC day", async () => {
    const slots = await open();
    vi.stubEnv("PRAMAAN_BOOKING_EMAIL_LIMIT", "1");
    await book(request(), { ...visitor, email: " SAM@example.com ", start: slots[0].start });
    await expect(book(request("192.0.2.2"), { ...visitor, email: "sam@EXAMPLE.com", start: slots[1].start })).rejects.toMatchObject({ status: 429 });
    expect(sent("calendar.event.create")).toHaveLength(1);
    resetPublicLimits();
    vi.stubEnv("PRAMAAN_BOOKING_DAILY_LIMIT", "1");
    await book(request(), { ...visitor, email: "new@example.com", start: slots[1].start });
    await expect(book(request(), { ...visitor, email: "third@example.com", start: slots[2].start })).rejects.toMatchObject({ status: 429 });
    expect(sent("calendar.event.create")).toHaveLength(2);
  });

  it("expires attempt counters and resets a daily cap at UTC midnight", () => {
    limitPublic("minute", "a", 1, 60_000, 0);
    expect(() => limitPublic("minute", "a", 1, 60_000, 59_999)).toThrow();
    expect(() => limitPublic("minute", "a", 1, 60_000, 60_000)).not.toThrow();
    limitPublic("day", "2026-11-01", 1, 1000, 0);
    expect(() => limitPublic("day", "2026-11-02", 1, 1000, 1)).not.toThrow();
  });

  it("applies the public write limit to the stop page", async () => {
    for (let i = 0; i < 10; i++) expect((await post(undefined, "/api/pramaan/consent/unsubscribe", {}, { "x-forwarded-for": "192.0.2.1" })).status).toBe(400);
    expect((await post(undefined, "/api/pramaan/consent/unsubscribe", {}, { "x-forwarded-for": "192.0.2.1" })).status).toBe(429);
  });

  it("caches concurrent availability reads for 60 seconds by host and range, but never booking checks", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-02T07:00:00Z"));
    const [slots] = await Promise.all([open(), open()]);
    expect(sent("calendar.free-busy.get")).toHaveLength(1);
    await availability(request(), { from: "2026-11-03" });
    expect(sent("calendar.free-busy.get")).toHaveLength(2);
    vi.stubEnv("PRAMAAN_BOOKING_HOST", "other-host");
    platform(fakeState()).connections.set("other-host", [{ app: "googlecalendar", status: "active" }] as never);
    await open();
    expect(sent("calendar.free-busy.get")).toHaveLength(3);
    vi.stubEnv("PRAMAAN_BOOKING_HOST", "user-42");
    vi.advanceTimersByTime(60_001);
    await open();
    expect(sent("calendar.free-busy.get")).toHaveLength(4);
    await book(request(), { ...visitor, start: slots[0].start });
    expect(sent("calendar.free-busy.get")).toHaveLength(5);
    await open(); // booking invalidated the cache
    expect(sent("calendar.free-busy.get")).toHaveLength(6);
  });

  it("does not cache failed free/busy calls", async () => {
    failNext("POST", "/v1/capabilities/calendar.free-busy.get", 503, { code: "internal", message: "Try later." });
    await expect(open()).rejects.toMatchObject({ status: 503 });
    expect((await open()).length).toBeGreaterThan(0);
    expect(sent("calendar.free-busy.get")).toHaveLength(2);
  });

  it("the fake merges busy intervals but lists individual referenced events", async () => {
    const at = Date.parse("2026-11-02T09:00:00Z");
    for (let i = 0; i < 2; i++) calendar(fakeState()).events.push({ ref: `ref_${i}`, user: "user-42", title: "Meeting", start: at, end: at + 1_800_000, createdAt: "2026-11-01T00:00:00Z" });
    const selector = { endUserRef: "user-42", app: "googlecalendar", after: new Date(at).toISOString(), before: new Date(at + 1_800_000).toISOString() };
    const busy = await capability<{ results: { busy: unknown[] }[] }>("calendar.free-busy.get", { calendars: [selector], after: selector.after, before: selector.before, timezone: "UTC" });
    expect(busy.results[0].busy).toHaveLength(1);
    const list = await capability<{ results: { ref: string; createdAt: string }[] }>("calendar.events.list", selector);
    expect(list.results).toHaveLength(2);
    expect(list.results.every((e) => e.ref && e.createdAt)).toBe(true);
  });

  it("only verifies bot tokens through Pramaan when configured and fails closed", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("Unexpected direct network call"));
    vi.stubGlobal("fetch", fetch);
    vi.stubEnv("PRAMAAN_BOT_CHECK_SECRET", "");
    await verifyBookingBot(request(), undefined);
    expect(sent("auth.bot-check.verify")).toHaveLength(0);
    vi.stubEnv("PRAMAAN_BOT_CHECK_SECRET", "test-secret");
    await expect(verifyBookingBot(request(), undefined)).rejects.toMatchObject({ status: 400 });
    expect(sent("auth.bot-check.verify")).toHaveLength(0);
    await verifyBookingBot(request(), "test-token");
    expect(sent("auth.bot-check.verify")[0].body).toEqual({ token: "test-token", remoteIp: "192.0.2.1" });
    await expect(verifyBookingBot(request(), "bad-token")).rejects.toMatchObject({ status: 400 });
    failNext("POST", "/v1/capabilities/auth.bot-check.verify", 503, { code: "internal", message: "Service unavailable" });
    await expect(verifyBookingBot(request(), "test-token")).rejects.toMatchObject({ status: 400 });
    expect(fetch).not.toHaveBeenCalled();
  });
});
