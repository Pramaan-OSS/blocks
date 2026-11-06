import { beforeEach, describe, expect, it } from "vitest";
import { failNext, fakeState, resetFake } from "@/lib/pramaan/fake";
import { activity } from "@/lib/pramaan/fake-activity";
import { get, post } from "./harness";

const A = "/api/pramaan/activity";
beforeEach(() => resetFake());

const json = async (res: Response) => ({ status: res.status, body: await res.json() });
const NOT_FOUND = { code: "not_found", message: "No such route." };

describe("activity routes", () => {
  it("lists calls newest first, 20 at a time, with a cursor for the rest", async () => {
    const first = (await json(await get(undefined, A))).body;
    expect(first.mode).toBe("calls");
    expect(first.results).toHaveLength(20);
    expect(first.results[0].status).toBe("done");
    const times = first.results.map((r: { created_at: string }) => r.created_at);
    expect([...times].sort().reverse()).toEqual(times);
    expect(first.nextCursor).toBeTruthy();
    const second = (await json(await get(undefined, `${A}?cursor=${first.nextCursor}`))).body;
    expect(second.results).toHaveLength(20);
    expect(second.nextCursor).toBeUndefined();
  });

  it("filters by what ran, how it went and the dates", async () => {
    const failed = (await json(await get(undefined, `${A}?status=failed`))).body.results;
    expect(failed.length).toBeGreaterThan(0);
    expect(failed.every((r: { status: string }) => r.status === "failed")).toBe(true);
    const mail = (await json(await get(undefined, `${A}?capability=email.send`))).body.results;
    expect(mail.every((r: { capability: string }) => r.capability === "email.send")).toBe(true);
    const today = new Date().toISOString().slice(0, 10);
    const recent = (await json(await get(undefined, `${A}?from=${today}&to=${today}`))).body.results;
    expect(recent.length).toBeGreaterThan(0);
    expect(recent.length).toBeLessThan(40);
    expect(recent.every((r: { created_at: string }) => r.created_at.startsWith(today))).toBe(true);
    const sent = fakeState().requests.find((r) => r.path === "/v1/calls")!;
    expect(sent).toBeTruthy();
  });

  it("refuses a bad filter in plain words, before any call", async () => {
    fakeState().requests.length = 0;
    expect((await json(await get(undefined, `${A}?status=weird`))).body.error.message).toBe("Choose done or failed.");
    expect((await json(await get(undefined, `${A}?from=yesterday`))).body.error.message).toBe("Dates look like 2026-10-31.");
    expect((await json(await get(undefined, `${A}?from=2026-10-31&to=2026-10-01`))).body.error.message).toBe("The start date must come before the end date.");
    expect((await json(await get(undefined, `${A}?capability=Not%20Valid`))).status).toBe(400);
    expect(fakeState().requests).toHaveLength(0);
  });

  it("shows a failed call with what went wrong and what to do next", async () => {
    const failed = (await json(await get(undefined, `${A}?status=failed&capability=email.send`))).body.results[0];
    const one = (await json(await get(undefined, `${A}/${failed.call_id}`))).body;
    expect(one.error).toEqual({ code: "connection_required", message: "This call failed.", next: "Check your app settings before trying again." });
    expect(one.charged_micro).toBe(0);
    expect((await json(await get(undefined, `${A}/call_nope`))).status).toBe(404);
    expect((await json(await get(undefined, `${A}/..%2Fx`))).status).toBe(400);
  });

  it("looks up one call through a bounded number of history pages", async () => {
    const a = activity(fakeState());
    for (let i = 0; i < 600; i++) a.calls.push({ ...a.calls[0], call_id: `call_more${i}` });
    fakeState().requests.length = 0;
    expect((await get(undefined, `${A}/call_nope`)).status).toBe(404);
    expect(fakeState().requests.filter((r) => r.path === "/v1/calls")).toHaveLength(5);
  });

  it("does not fall back to usage when call history refuses", async () => {
    failNext("GET", "/v1/calls", 404, NOT_FOUND);
    expect((await get(undefined, A)).status).toBe(404);
    expect(fakeState().requests.some((r) => r.path === "/v1/usage")).toBe(false);
  });

  it("only a missing route falls back: any other refusal shows the API's own message", async () => {
    failNext("GET", "/v1/calls", 429, { code: "rate_limited", message: "Too many requests. Wait a minute, then try again." });
    expect(await json(await get(undefined, A))).toMatchObject({ status: 429, body: { error: { message: "Too many requests. Wait a minute, then try again." } } });
  });

  it("lists delivery history and queues replay, preserving rate limits", async () => {
    const ok = (await json(await get(undefined, `${A}/deliveries`))).body;
    expect(ok.results[0].event).toBe("job.finished");
    const id = ok.results[0].delivery_id;
    expect((await json(await post(undefined, `${A}/deliveries/${id}/replay`))).body.status).toBe("queued");
    for (let i = 0; i < 9; i++) expect((await post(undefined, `${A}/deliveries/${id}/replay`)).status).toBe(200);
    expect((await post(undefined, `${A}/deliveries/${id}/replay`)).status).toBe(429);
    failNext("GET", "/v1/webhook-deliveries", 404, NOT_FOUND);
    expect((await get(undefined, `${A}/deliveries`)).status).toBe(404);
  });

});
