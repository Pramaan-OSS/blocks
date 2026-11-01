import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BOOKING, availability, book } from "@/lib/pramaan/booking";
import { clientIp, limitPublic, resetPublicLimits, warnPublicIpSetup } from "@/lib/pramaan/public-guard";
import { decideElsewhere, failNext, fakeState, resetFake } from "@/lib/pramaan/fake";
import { calendar, type CalEvent } from "@/lib/pramaan/fake-wave3";
import { platform } from "@/lib/pramaan/fake-platform";
import * as server from "@/lib/pramaan/server";
import { callRoute, post, useClock } from "./harness";
import { register } from "../registry/booking/instrumentation";

const visitor = { name: "Sam", email: "sam@example.com" };
const request = (headers: Record<string, string> = { "x-forwarded-for": "192.0.2.1" }) => new Request("http://app.test/api/pramaan/booking", { headers });
const sent = (id: string) => fakeState().requests.filter((r) => r.path === `/v1/capabilities/${id}`);
const original = structuredClone(BOOKING);
const open = async () => {
  const result = await availability(request(), {});
  if (result.state !== "ready") throw new Error("Missing calendar");
  return result.slots;
};
// Settle requests and their short retry/confirmation delays without wall-clock sleeps.
async function finish<T>(promise: Promise<T>): Promise<T> {
  const settled = promise.then((value) => ({ value }), (error: unknown) => ({ error }));
  await vi.runAllTimersAsync();
  const result = await settled;
  if ("error" in result) throw result.error;
  return result.value;
}
const fixture = (slot: { start: string; end: string }, extra: Partial<CalEvent> = {}): CalEvent => ({
  ref: "ref_earlier", user: "user-42", title: "Other event", createdAt: "2026-11-01T00:00:00Z",
  start: Date.parse(slot.start), end: Date.parse(slot.end), ...extra,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-02T07:00:00Z"));
  resetFake();
  useClock(fakeState(), 0);
  platform(fakeState()).connections.get("user-42")!.find((c) => c.app === "googlecalendar")!.status = "active";
});
afterEach(() => {
  Object.assign(BOOKING, structuredClone(original));
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("booking review regressions", () => {
  // Finding 1: the fake must expose entries that free/busy intentionally ignores.
  it.each([
    { allDay: true, transparency: "free" as const },
    { transparency: "free" as const },
    { transparency: "transparent" as const },
    { responseStatus: "declined" as const },
    { status: "cancelled" as const },
  ])("keeps a booking beside an ignored calendar entry: %j", async (flags) => {
    const [slot] = await open();
    calendar(fakeState()).events.push(fixture(slot, { ...flags, createdAt: undefined }));
    calendar(fakeState()).immediate = true;
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(finish(book(request(), { ...visitor, start: slot.start }))).resolves.toMatchObject({ status: "booked" });
    expect(sent("calendar.events.list")).toHaveLength(2);
    expect(sent("calendar.event.delete")).toHaveLength(0);
    expect(calendar(fakeState()).events).toHaveLength(2);
    expect(warning).not.toHaveBeenCalled();
    const rows = await server.capability<{ results: Record<string, unknown>[] }>("calendar.events.list", { endUserRef: "user-42", app: "googlecalendar", after: slot.start, before: slot.end });
    expect(rows.results.find((e) => e.ref === "ref_earlier")).toMatchObject(flags);
  });

  it("skips an all-day entry that appears after the fresh busy check", async () => {
    const [slot] = await open();
    calendar(fakeState()).immediate = true;
    const real = server.capability;
    vi.spyOn(server, "capability").mockImplementation(async (id, input, headers) => {
      if (id === "calendar.events.list" && calendar(fakeState()).events.length === 1) calendar(fakeState()).events.push(fixture(slot, { allDay: true }));
      return real(id, input, headers);
    });
    await expect(finish(book(request(), { ...visitor, start: slot.start }))).resolves.toMatchObject({ status: "booked" });
    expect(sent("calendar.event.delete")).toHaveLength(0);
  });

  it("only requires createdAt on overlapping competing events", async () => {
    const [slot] = await open();
    calendar(fakeState()).immediate = true;
    const real = server.capability;
    vi.spyOn(server, "capability").mockImplementation(async (id, input, headers) => {
      const response = await real(id, input, headers);
      if (id === "calendar.events.list") (response as { results: unknown[] }).results.push({ ref: "ref_elsewhere", startAt: "2026-11-03T09:00:00Z", endAt: "2026-11-03T09:30:00Z" });
      return response;
    });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(finish(book(request(), { ...visitor, start: slot.start }))).resolves.toMatchObject({ status: "booked" });
    expect(warning).not.toHaveBeenCalled();
  });

  // Finding 2: trust only the configured proxy chain, never a forged leftmost entry.
  it("limits forged leftmost IPs together and honors the configured trusted proxy hops", async () => {
    vi.stubEnv("PRAMAAN_BOOKING_GET_LIMIT", "1");
    expect((await callRoute(request({ "x-forwarded-for": "198.51.100.1, 192.0.2.10" }))).status).toBe(200);
    expect((await callRoute(request({ "x-forwarded-for": "198.51.100.2, 192.0.2.10" }))).status).toBe(429);
    vi.stubEnv("PRAMAAN_TRUSTED_PROXY_HOPS", "2");
    expect(clientIp(request({ "x-forwarded-for": "forged, 192.0.2.20, 192.0.2.30" }))).toBe("192.0.2.20");
    expect(clientIp(request({ "x-real-ip": "192.0.2.40", "x-forwarded-for": "forged, 192.0.2.20, 192.0.2.30" }))).toBe("192.0.2.20");
    vi.stubEnv("PRAMAAN_TRUSTED_IP_HEADER", "x-real-ip");
    expect(clientIp(request({ "x-real-ip": "192.0.2.40", "x-forwarded-for": "forged, 192.0.2.20, 192.0.2.30" }))).toBe("192.0.2.40");
  });

  it("ignores forged x-real-ip unless explicitly trusted", async () => {
    vi.stubEnv("PRAMAAN_BOOKING_GET_LIMIT", "1");
    const forwarded = "192.0.2.10";
    expect((await callRoute(request({ "x-real-ip": "198.51.100.1", "x-forwarded-for": forwarded }))).status).toBe(200);
    expect((await callRoute(request({ "x-real-ip": "198.51.100.2", "x-forwarded-for": forwarded }))).status).toBe(429);
    vi.stubEnv("PRAMAAN_TRUSTED_IP_HEADER", "x-real-ip");
    expect((await callRoute(request({ "x-real-ip": "198.51.100.2", "x-forwarded-for": forwarded }))).status).toBe(200);
    expect(clientIp(request({ "x-real-ip": "not-an-ip", "x-forwarded-for": forwarded }))).toBe(forwarded);
  });

  it("bounds missing-IP GET, POST and unsubscribe with a shared limit ten times higher", async () => {
    expect(clientIp(request({}))).toBeUndefined();
    vi.stubEnv("PRAMAAN_BOOKING_GET_LIMIT", "1");
    vi.stubEnv("PRAMAAN_BOOKING_IP_LIMIT", "1");
    for (let i = 0; i < 10; i++) {
      expect((await callRoute(request({}))).status).toBe(200);
      expect((await post(undefined, "/api/pramaan/booking", {})).status).toBe(400);
    }
    expect((await callRoute(request({}))).status).toBe(429);
    expect((await post(undefined, "/api/pramaan/booking", {})).status).toBe(429);
    for (let i = 0; i < 100; i++) expect((await post(undefined, "/api/pramaan/consent/unsubscribe", {})).status).toBe(400);
    expect((await post(undefined, "/api/pramaan/consent/unsubscribe", {})).status).toBe(429);
    expect(sent("calendar.free-busy.get")).toHaveLength(1);
    // A known IP keeps its own normal-size quota, separate from the missing-IP bucket.
    expect((await callRoute(request())).status).toBe(200);
    expect((await callRoute(request())).status).toBe(429);
  });

  it("logs the proxy-header startup warning once, including after fallback requests", async () => {
    vi.stubGlobal("__pramaanIpWarningShown", false);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    await register();
    await register();
    warnPublicIpSetup();
    limitPublic("startup-test", undefined, 1, 60_000);
    expect(warning).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("IP limits need a trusted proxy header"));
  });

  // Findings 3 and 4: after creation, read failures never turn the slot back into an offer.
  it.each(["missing ref", "failed read"])("retries events.list when it has a %s", async (mode) => {
    const [slot] = await open();
    calendar(fakeState()).immediate = true;
    const real = server.capability;
    let reads = 0;
    vi.spyOn(server, "capability").mockImplementation(async (id, input, headers) => {
      if (id === "calendar.events.list" && ++reads < 3) {
        if (mode === "failed read") throw new Error("Temporary read failure");
        return { results: [] } as never;
      }
      return real(id, input, headers);
    });
    await expect(finish(book(request(), { ...visitor, start: slot.start }))).resolves.toMatchObject({ status: "booked" });
    expect(reads).toBe(4); // third attempt sees ours, then the delayed winner check
    expect((await open()).map((s) => s.start)).not.toContain(slot.start);
  });

  it("returns booked, logs for the owner and retains the hold when all three reads fail", async () => {
    const [slot] = await open();
    calendar(fakeState()).immediate = true;
    const real = server.capability;
    let reads = 0;
    vi.spyOn(server, "capability").mockImplementation(async (id, input, headers) => {
      if (id === "calendar.events.list") { reads++; throw new Error("Read unavailable"); }
      return real(id, input, headers);
    });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(finish(book(request(), { ...visitor, start: slot.start }))).resolves.toMatchObject({ status: "booked" });
    expect(reads).toBe(3);
    expect(warning).toHaveBeenCalled();
    // Hide the event to model a lagging calendar. The local hold must still exclude it.
    calendar(fakeState()).events = [];
    expect((await open()).map((s) => s.start)).not.toContain(slot.start);
    await expect(book(request(), { ...visitor, email: "next@example.com", start: slot.start })).rejects.toMatchObject({ status: 409 });
    expect(sent("calendar.event.create")).toHaveLength(1);
  });

  it.each(["pending", "failed"])("keeps the hold and returns booked when losing deletion is %s", async (mode) => {
    const [slot] = await open();
    calendar(fakeState()).immediate = true;
    const real = server.capability;
    vi.spyOn(server, "capability").mockImplementation(async (id, input, headers) => {
      if (id === "calendar.events.list") calendar(fakeState()).events.push(fixture(slot));
      if (id === "calendar.event.delete") {
        if (mode === "failed") throw new Error("Deletion unavailable");
        return { status: "running" } as never;
      }
      return real(id, input, headers);
    });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(finish(book(request(), { ...visitor, start: slot.start }))).resolves.toMatchObject({ status: "booked" });
    const ours = calendar(fakeState()).events.find((e) => e.ref !== "ref_earlier")!;
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("Two bookings overlap"), {
      start: slot.start, end: slot.end, savedEventRef: ours.ref, competingEventRef: "ref_earlier",
    });
    calendar(fakeState()).events = [];
    expect((await open()).map((s) => s.start)).not.toContain(slot.start);
    await expect(book(request(), { ...visitor, email: "next@example.com", start: slot.start })).rejects.toMatchObject({ status: 409 });
  });

  it("the delayed winner check removes ours when an earlier creation appears late, and sends cancellation", async () => {
    const [slot] = await open();
    calendar(fakeState()).immediate = true;
    const real = server.capability;
    const readTimes: number[] = [];
    vi.spyOn(server, "capability").mockImplementation(async (id, input, headers) => {
      if (id === "calendar.events.list") {
        readTimes.push(Date.now());
        if (readTimes.length === 2) calendar(fakeState()).events.push(fixture(slot));
      }
      return real(id, input, headers);
    });
    await expect(finish(book(request(), { ...visitor, start: slot.start }))).rejects.toMatchObject({ status: 409 });
    expect(readTimes).toHaveLength(2);
    expect(readTimes[1] - readTimes[0]).toBeGreaterThanOrEqual(1000);
    expect(sent("calendar.event.delete")[0].body).toMatchObject({ sendInvites: true });
    expect(calendar(fakeState()).events.map((e) => e.ref)).toEqual(["ref_earlier"]);
    // Successful cleanup also keeps the slot held; a replay must not report the deleted event booked.
    await expect(book(request(), { ...visitor, start: slot.start })).rejects.toMatchObject({ status: 409 });
  });

  it.each(["denied", "expired"] as const)("keeps a pending hold past 15 minutes, then releases it when %s", async (outcome) => {
    const [slot] = await open();
    await book(request(), { ...visitor, start: slot.start });
    const approval = [...fakeState().approvals.values()].at(-1)!;
    approval.expiresAt = Date.now() + 3_600_000;
    vi.advanceTimersByTime(16 * 60_000);
    expect((await open()).map((s) => s.start)).not.toContain(slot.start);
    if (outcome === "denied") decideElsewhere(approval.id, "denied");
    else approval.expiresAt = Date.now();
    fakeState().now = () => Date.now();
    vi.advanceTimersByTime(30_001);
    expect((await open()).map((s) => s.start)).toContain(slot.start);
    expect(fakeState().requests.some((r) => r.path === `/v1/jobs/${approval.id}`)).toBe(true);
  });

  it("releases the slot when an approved creation job subsequently failed", async () => {
    const [slot] = await open();
    await book(request(), { ...visitor, start: slot.start });
    const approval = [...fakeState().approvals.values()].at(-1)!;
    const real = server.pramaan;
    vi.spyOn(server, "pramaan").mockImplementation(async (path, init) => {
      if (path === `/v1/jobs/${approval.id}`) return { status: "failed", approval: { status: "approved" } } as never;
      return real(path, init);
    });
    expect((await open()).map((s) => s.start)).toContain(slot.start);
    await expect(book(request(), { ...visitor, email: "next@example.com", start: slot.start })).resolves.toMatchObject({ status: "requested" });
    expect(sent("calendar.event.create")).toHaveLength(2);
  });

  it("keeps pending holds until slot end if the approval cannot be read", async () => {
    const [slot] = await open();
    await book(request(), { ...visitor, start: slot.start });
    const approval = [...fakeState().approvals.values()].at(-1)!;
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    failNext("GET", `/v1/jobs/${approval.id}`, 503, { code: "internal", message: "Try later" });
    expect((await open()).map((s) => s.start)).not.toContain(slot.start);
    expect(warning).toHaveBeenCalled();
    // Looking after slot end must not query the old job again.
    const reads = fakeState().requests.filter((r) => r.path === `/v1/jobs/${approval.id}`).length;
    vi.setSystemTime(Date.parse(slot.end) + 1);
    await open();
    expect(fakeState().requests.filter((r) => r.path === `/v1/jobs/${approval.id}`)).toHaveLength(reads);
  });

  // Findings 5 and 8: a missing bot token cannot burn another person's email quota.
  it("checks the configured bot token through POST before counting email attempts or calendar work", async () => {
    const [slot] = await open();
    fakeState().requests.length = 0;
    vi.stubEnv("PRAMAAN_BOT_CHECK_SECRET", "test-secret");
    vi.stubEnv("PRAMAAN_BOOKING_EMAIL_LIMIT", "1");
    const fetch = vi.fn().mockRejectedValue(new Error("Unexpected direct network call"));
    vi.stubGlobal("fetch", fetch);
    for (let i = 0; i < 2; i++) {
      const result = await post(undefined, "/api/pramaan/booking", { ...visitor, start: slot.start });
      expect(result.status).toBe(400);
      expect(JSON.stringify(await result.json())).toContain("complete the security check");
    }
    expect(fakeState().requests).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
    const result = await post(undefined, "/api/pramaan/booking", { ...visitor, start: slot.start, botCheckToken: "test-token" });
    expect(result.status).toBe(200);
    expect(fetch).not.toHaveBeenCalled();
    expect(sent("auth.bot-check.verify")).toHaveLength(1);
    expect(sent("auth.bot-check.verify")[0].body).toEqual({ token: "test-token" });
    expect(sent("calendar.event.create")).toHaveLength(1);
  });

  it.each([
    ["V.ictim+one@gmail.com", "victim+two@googlemail.com"],
    ["victim+one@example.com", "victim+two@example.com"],
  ])("limits aliases %s and %s together while inviting the original address", async (first, second) => {
    const slots = await open();
    vi.stubEnv("PRAMAAN_BOOKING_EMAIL_LIMIT", "1");
    await book(request(), { ...visitor, email: first, start: slots[0].start });
    await expect(book(request({ "x-forwarded-for": "192.0.2.2" }), { ...visitor, email: second, start: slots[1].start })).rejects.toMatchObject({ status: 429 });
    expect(sent("calendar.event.create")[0].body).toMatchObject({ attendees: [{ email: first, name: "Sam" }] });
  });

  // Finding 6: no paid calendar reads for dates we could never offer.
  it("rejects from outside the host's date window before any capability call", async () => {
    for (const from of ["2000-01-01", "2026-10-31", "2026-11-17", "9999-12-31"]) {
      await expect(availability(request(), { from })).rejects.toMatchObject({ status: 400, message: "Choose a date within the booking window." });
    }
    expect(fakeState().requests).toHaveLength(0);
  });

  it("returns no slots without a free/busy call when candidates are empty", async () => {
    const result = await availability(request(), { from: "2026-11-01", days: "1" });
    expect(result).toMatchObject({ state: "ready", slots: [] });
    expect(fakeState().requests).toHaveLength(0);
  });

  // Finding 7: 1,000 attempts in a second cause one cleanup, not 1,000 scans.
  it("prunes rate counters at most once a second and still resets an individually expired counter", () => {
    resetPublicLimits();
    const iterate = vi.spyOn(Map.prototype, Symbol.iterator);
    for (let i = 0; i < 1000; i++) limitPublic("load", String(i), 2, 60_000, i);
    const initialScans = iterate.mock.calls.length;
    limitPublic("load", "next", 2, 60_000, 1000);
    const laterScans = iterate.mock.calls.length;
    iterate.mockRestore();
    expect(initialScans).toBe(1);
    expect(laterScans).toBe(2);
    resetPublicLimits();
    limitPublic("short", "same", 1, 100, 0);
    expect(() => limitPublic("short", "same", 1, 100, 101)).not.toThrow();
  });
});
