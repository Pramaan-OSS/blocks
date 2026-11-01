import { describe, expect, it } from "vitest";
import { clock, currentCall, finishedCalls, formatNumber, sanitizeNumber } from "@/lib/pramaan/dialler";
import type { PhoneEvent } from "@/lib/pramaan/voice";

const ev = (id: number, type: string, at: string, extra: Partial<PhoneEvent> = {}): PhoneEvent => ({ id: `ve_${id}`, type, at, callRef: "ref_a", to: "+14155550100", ...extra });

describe("dialler helpers", () => {
  it("formats numbers as a person reads them", () => {
    expect(formatNumber("+14155550100")).toBe("+1 415 555 0100");
    expect(formatNumber("+442071838750")).toBe("+44 207 183 8750");
    expect(formatNumber("4155550100")).toBe("415 555 0100");
    expect(formatNumber("+1")).toBe("+1");
    expect(formatNumber("")).toBe("");
  });

  it("keeps digits, star, hash and one leading plus", () => {
    expect(sanitizeNumber("+1 (415) 555-0100")).toBe("+14155550100");
    expect(sanitizeNumber("1+2+3")).toBe("123");
    expect(sanitizeNumber("*#21#abc")).toBe("*#21#");
  });

  it("runs a clock", () => {
    expect([clock(0), clock(7), clock(65), clock(3725), clock(-3)]).toEqual(["0:00", "0:07", "1:05", "1:02:05", "0:00"]);
  });

  it("follows a call from dialling to the end, and lists it once finished", () => {
    const dialing = ev(1, "call.dialing", "2026-11-01T10:00:00Z");
    const connected = ev(2, "call.connected", "2026-11-01T10:00:02Z");
    expect(currentCall([dialing])).toMatchObject({ phase: "calling", callRef: "ref_a", to: "+14155550100" });
    expect(currentCall([dialing, connected])).toMatchObject({ phase: "connected", connectedAt: Date.parse("2026-11-01T10:00:02Z") });
    expect(finishedCalls([dialing, connected])).toEqual([]);
    const ended = ev(3, "call.ended", "2026-11-01T10:00:44Z", { reason: "completed" });
    expect(currentCall([dialing, connected, ended]).phase).toBe("idle");
    expect(finishedCalls([dialing, connected, ended])).toEqual([
      { id: "ref_a", direction: "out", number: "+14155550100", at: "2026-11-01T10:00:00Z", seconds: 42, outcome: "Answered", missed: false },
    ]);
  });

  it("words a call that never connected", () => {
    const busy = finishedCalls([ev(1, "call.dialing", "2026-11-01T10:00:00Z"), ev(2, "call.failed", "2026-11-01T10:00:01Z", { reason: "busy" })]);
    expect(busy[0]).toMatchObject({ outcome: "Busy", missed: true });
    expect(busy[0].seconds).toBeUndefined();
    expect(finishedCalls([ev(1, "call.dialing", "2026-11-01T10:00:00Z"), ev(2, "call.rejected", "2026-11-01T10:00:01Z")])[0].outcome).toBe("Declined");
  });
});
