import { beforeEach, describe, expect, it } from "vitest";
import { decideElsewhere, fakeState, resetFake } from "@/lib/pramaan/fake";
import { platform } from "@/lib/pramaan/fake-platform";
import { BOOKING } from "@/lib/pramaan/booking";
import { get, post, useClock } from "./harness";

beforeEach(() => {
  resetFake();
  useClock(fakeState(), 1_000);
});

const sent = (id: string) => fakeState().requests.filter((r) => r.path === `/v1/capabilities/${id}`);
const connect = () => void (platform(fakeState()).connections.get("user-42")!.find((x) => x.app === "googlecalendar")!.status = "active");
type Slots = { state: string; reason?: string; slots: { start: string; end: string }[] };
const slots = async (query = "") => (await (await get(undefined, `/api/pramaan/booking${query}`)).json()) as Slots;
const visitor = { name: "Sam Lee", email: "sam@example.com", notes: "Keen to talk" };
const approveLast = () => decideElsewhere([...fakeState().approvals.keys()].at(-1)!, "approved");

describe("booking server half", () => {
  it("says needs reconnect when the calendar's sign-in has lapsed, and asks nothing of the calendar", async () => {
    expect(await slots()).toEqual({ state: "needs_connection", reason: "needs_reconnect" });
    expect(sent("calendar.free-busy.get")).toHaveLength(0);
  });

  it("says not connected when no calendar app is linked at all", async () => {
    platform(fakeState()).connections.get("user-42")!.splice(0);
    expect(await slots()).toEqual({ state: "needs_connection", reason: "not_connected" });
  });

  it("offers only open times inside the hours, on the days taken, and never what is on the calendar", async () => {
    connect();
    const r = await slots("?days=14");
    expect(r.state).toBe("ready");
    expect(r.slots.length).toBeGreaterThan(0);
    for (const s of r.slots) {
      const d = new Date(s.start);
      expect(d.getUTCDay()).toBeGreaterThanOrEqual(1);
      expect(d.getUTCDay()).toBeLessThanOrEqual(5);
      expect(d.getUTCHours()).toBeGreaterThanOrEqual(BOOKING.hours[0]);
      expect(d.getUTCHours()).toBeLessThan(BOOKING.hours[1]);
      expect(d.getUTCHours() === 15).toBe(false); // the fake calendar is busy 15:00 to 16:00 UTC
      expect(Date.parse(s.end) - d.getTime()).toBe(BOOKING.slotMinutes * 60_000);
    }
    expect(JSON.stringify(r)).not.toMatch(/busy/);
  });

  it("refuses a bad date or day count before asking the calendar", async () => {
    connect();
    for (const q of ["?from=tomorrow", "?days=0", "?days=99", "?days=x"]) expect((await get(undefined, `/api/pramaan/booking${q}`)).status).toBe(400);
    expect(sent("calendar.free-busy.get")).toHaveLength(0);
  });

  it("a booking waits for a yes, then the time is taken", async () => {
    connect();
    const [first] = (await slots()).slots;
    const res = await post(undefined, "/api/pramaan/booking", { start: first.start, ...visitor }, { "Idempotency-Key": "b1" });
    expect(await res.json()).toEqual({ status: "requested", start: first.start, end: first.end });
    expect(sent("calendar.event.create")[0].body).toMatchObject({ app: "googlecalendar", title: "Meeting with Sam Lee", attendees: [{ email: "sam@example.com", name: "Sam Lee" }], sendInvites: true });
    expect((await slots()).slots.map((s) => s.start)).not.toContain(first.start);
    approveLast();
    expect((await slots()).slots.map((s) => s.start)).not.toContain(first.start);
    const again = await post(undefined, "/api/pramaan/booking", { start: first.start, ...visitor });
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: { message: string } }).error.message).toContain("just taken");
  });

  it("one click makes one approval, even sent twice", async () => {
    connect();
    const [first] = (await slots()).slots;
    for (let i = 0; i < 2; i++) await post(undefined, "/api/pramaan/booking", { start: first.start, ...visitor }, { "Idempotency-Key": "same" });
    expect([...fakeState().approvals.values()].filter((a) => a.capability === "calendar.event.create")).toHaveLength(1);
  });

  it("refuses a time that isn't on offer, and bad details, before any event is made", async () => {
    connect();
    const [first] = (await slots()).slots;
    const at3am = new Date(Date.parse(first.start) - 12 * 3_600_000).toISOString();
    for (const [body, words] of [
      [{ start: at3am, ...visitor }, "isn't one of the open times"],
      [{ start: first.start, ...visitor, name: "" }, "Enter your name"],
      [{ start: first.start, ...visitor, email: "nope" }, "email address"],
      [{ start: first.start, ...visitor, notes: "x".repeat(501) }, "under 500"],
      [{ ...visitor }, "Pick a time"],
    ] as const) {
      const res = await post(undefined, "/api/pramaan/booking", body);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: { message: string } }).error.message).toContain(words);
    }
    expect(sent("calendar.event.create")).toHaveLength(0);
  });

  it("won't book when the calendar isn't connected", async () => {
    const res = await post(undefined, "/api/pramaan/booking", { start: new Date(Date.now() + 5 * 86_400_000).toISOString(), ...visitor });
    expect([400, 503]).toContain(res.status);
    expect(sent("calendar.event.create")).toHaveLength(0);
  });
});
