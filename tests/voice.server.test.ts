import { beforeEach, describe, expect, it, vi } from "vitest";
import { decideElsewhere, failNext, fakeState, resetFake } from "@/lib/pramaan/fake";
import { FAKE_BUSY_NUMBER } from "@/lib/pramaan/fake-wave3";
import { get, post, useClock } from "./harness";

let clock: ReturnType<typeof useClock>;
beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("APP_URL", "https://app.test");
  resetFake();
  clock = useClock(fakeState(), 1_000);
});

const sent = (id: string) => fakeState().requests.filter((r) => r.path === `/v1/capabilities/${id}`);
type Event = { id: string; type: string; reason?: string; callRef?: string };
const events = async (ref: string, cursor?: string) =>
  ((await (await get(undefined, `/api/pramaan/voice?ref=${ref}${cursor ? `&cursor=${cursor}` : ""}`)).json()) as { events: Event[] }).events;
const open = async () => (await (await post(undefined, "/api/pramaan/voice", { action: "open" }, { "Idempotency-Key": "open-1" })).json()) as { ref: string; credential: string; standIn: boolean };
const approveLast = () => decideElsewhere([...fakeState().approvals.keys()].at(-1)!, "approved");

describe("voice call server half", () => {
  it("opens a phone session for the signed-in person, from this app's own address", async () => {
    const s = await open();
    expect(s.credential).toBeTruthy();
    expect(s.standIn).toBe(true);
    expect(sent("voice.browser-session.create")[0].body).toMatchObject({ agent: "user-42", from: "+14155550100", origin: "https://app.test" });
    expect(sent("voice.browser-session.create")[0].headers["idempotency-key"]).toBe("open-1");
  });

  it("lists the lines to call from, and opens on the one chosen but never on a number that isn't listed", async () => {
    const res = (await (await get(undefined, "/api/pramaan/voice")).json()) as { numbers: string[]; standIn: boolean };
    expect(res).toEqual({ numbers: ["+14155550100", "+442071838750"], standIn: true });
    await post(undefined, "/api/pramaan/voice", { action: "open", from: "+442071838750" });
    expect(sent("voice.browser-session.create")[0].body).toMatchObject({ from: "+442071838750" });
    const refused = await post(undefined, "/api/pramaan/voice", { action: "open", from: "+15550001111" });
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: { message: string } }).error.message).toBe("Choose one of your numbers from the list.");
    expect(sent("voice.browser-session.create")).toHaveLength(1);
  });

  it("several lines come from one setting, comma separated", async () => {
    vi.stubEnv("PRAMAAN_VOICE_NUMBERS", "+14155550100, +14155550111");
    expect(((await (await get(undefined, "/api/pramaan/voice")).json()) as { numbers: string[] }).numbers).toEqual(["+14155550100", "+14155550111"]);
  });

  it("a call waits for a yes, then dials and connects", async () => {
    const { ref } = await open();
    const res = await post(undefined, "/api/pramaan/voice", { action: "call", ref, to: "+1 (415) 555-0100" }, { "Idempotency-Key": "c1" });
    expect(await res.json()).toEqual({ status: "waiting_for_approval" });
    expect(sent("voice.browser-call.start")[0].body).toEqual({ ref, to: "+14155550100" });
    expect(await events(ref)).toEqual([]);
    approveLast();
    const first = await events(ref);
    expect(first.map((e) => e.type)).toEqual(["call.dialing"]);
    clock.advance(1_500);
    const later = await events(ref, first[0].id);
    expect(later.map((e) => e.type)).toEqual(["call.connected"]);
    expect(await events(ref, later[0].id)).toEqual([]);
  });

  it("one click makes one approval, even sent twice", async () => {
    const { ref } = await open();
    for (let i = 0; i < 2; i++) await post(undefined, "/api/pramaan/voice", { action: "call", ref, to: "+14155550100" }, { "Idempotency-Key": "same" });
    expect([...fakeState().approvals.values()].filter((a) => a.capability === "voice.browser-call.start")).toHaveLength(1);
  });

  it("a busy line ends the call with its reason", async () => {
    const { ref } = await open();
    await post(undefined, "/api/pramaan/voice", { action: "call", ref, to: FAKE_BUSY_NUMBER });
    approveLast();
    clock.advance(1_500);
    const all = await events(ref);
    expect(all.map((e) => e.type)).toEqual(["call.dialing", "call.failed"]);
    expect(all[1].reason).toBe("busy");
  });

  it("hang up ends a connected call, and hanging up twice is fine", async () => {
    const { ref } = await open();
    await post(undefined, "/api/pramaan/voice", { action: "call", ref, to: "+14155550100" });
    approveLast();
    clock.advance(1_500);
    const callRef = (await events(ref))[0].callRef!;
    for (let i = 0; i < 2; i++) expect(await (await post(undefined, "/api/pramaan/voice", { action: "end", callRef })).json()).toEqual({ status: "ended" });
    const types = (await events(ref)).map((e) => e.type);
    expect(types.filter((t) => t === "call.ended")).toHaveLength(1);
  });

  it("closing the phone ends calls and refuses new ones, with the API's words", async () => {
    const { ref } = await open();
    await post(undefined, "/api/pramaan/voice", { action: "call", ref, to: "+14155550100" });
    approveLast();
    clock.advance(1_500);
    await events(ref);
    await post(undefined, "/api/pramaan/voice", { action: "close", ref });
    expect((await events(ref)).map((e) => e.type)).toEqual(["call.dialing", "call.connected", "call.ended", "session.closed"]);
    const late = await post(undefined, "/api/pramaan/voice", { action: "call", ref, to: "+14155550100" });
    expect(late.status).toBe(409);
    expect(((await late.json()) as { error: { message: string } }).error.message).toContain("has ended");
  });

  it("a session runs out by itself", async () => {
    const { ref } = await open();
    clock.advance(901_000);
    expect((await events(ref)).map((e) => e.type)).toEqual(["session.expired"]);
  });

  it("refuses a bad number, a bad session, a bad cursor and an unknown action before any call", async () => {
    const { ref } = await open();
    for (const [body, words] of [
      [{ action: "call", ref, to: "4155550100" }, "country code"],
      [{ action: "call", ref, to: "" }, "country code"],
      [{ action: "call", ref: "../x", to: "+14155550100" }, "couldn't be found"],
      [{ action: "end", callRef: 7 }, "couldn't be found"],
      [{ action: "nope" }, "Choose what"],
    ] as const) {
      const res = await post(undefined, "/api/pramaan/voice", body);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: { message: string } }).error.message).toContain(words);
    }
    expect((await get(undefined, `/api/pramaan/voice?ref=${ref}&cursor=../`)).status).toBe(400);
    expect(sent("voice.browser-call.start")).toHaveLength(0);
    expect(sent("voice.call.end")).toHaveLength(0);
    expect(sent("voice.browser-session.events")).toHaveLength(0);
  });

  it("passes the API's message through, and shows no provider name", async () => {
    const { ref } = await open();
    failNext("POST", "/v1/capabilities/voice.browser-call.start", 402, { code: "insufficient_balance", message: "Not enough credit for this call.", next: "Add credit." });
    const res = await post(undefined, "/api/pramaan/voice", { action: "call", ref, to: "+14155550100" });
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: { code: "insufficient_balance", message: "Not enough credit for this call.", next: "Add credit." } });
    const text = await (await post(undefined, "/api/pramaan/voice", { action: "open" })).text();
    expect(text).not.toMatch(/twilio|telnyx|plivo|vonage|bandwidth|exotel/i);
  });
});
