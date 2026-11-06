import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { failNext, fakePramaanFetch, fakeState, resetFake } from "@/lib/pramaan/fake";
import { get, post } from "./harness";

const C = "/api/pramaan/consent";
const owner = "mbr_owner";
const viewer = "mbr_viewer";
beforeEach(() => resetFake());
afterEach(() => vi.restoreAllMocks());

const json = async (res: Response) => ({ status: res.status, body: await res.json() });
const calls = (id: string) => fakeState().requests.filter((r) => r.path.endsWith(id));

describe("consent routes", () => {
  it("lists the project's opt-outs with shortened addresses only, and the STOP replies read-only", async () => {
    const { status, body } = await json(await get(owner, C));
    expect(status).toBe(200);
    expect(body.results.map((e: { channel: string; source: string }) => [e.channel, e.source])).toEqual([
      ["sms", "builder_api"],
      ["email", "unsubscribe_link"],
      ["all", "builder_api"],
    ]);
    expect(JSON.stringify(body)).not.toMatch(/14155550100|pat@example|442071838750/);
    expect(body.results[0].addressHint).toBe("+14…00");
    expect(body.organisationStops).toHaveLength(1);
    expect(body.viewer).toMatchObject({ canApprove: true });
    expect((await json(await get(viewer, C))).body.viewer.canApprove).toBe(false);
  });

  it("nobody signed in gets a plain answer and no call is made", async () => {
    const res = await json(await get("none", C));
    expect(res).toMatchObject({ status: 401, body: { error: { message: "Sign in to see this." } } });
    expect((await post("none", C, { address: "+14155550101" })).status).toBe(401);
    expect(calls("messaging.opt-outs.list")).toHaveLength(0);
    expect(calls("messaging.opt-out.add")).toHaveLength(0);
  });

  it("checks whether a message would be refused, per channel", async () => {
    const q = (a: string, ch: string) => `${C}/check?address=${encodeURIComponent(a)}&channel=${ch}`;
    expect((await json(await get(owner, q("+1 415 555 0100", "sms")))).body).toEqual({ blocked: true });
    expect((await json(await get(owner, q("+14155550100", "whatsapp")))).body).toEqual({ blocked: false });
    expect((await json(await get(owner, q("+442071838750", "voice")))).body).toEqual({ blocked: true });
    const bad = await json(await get(owner, q("not an address", "sms")));
    expect(bad).toMatchObject({ status: 400, body: { error: { message: expect.stringContaining("phone number with its country code") } } });
    expect((await json(await get(owner, q("+14155550100", "fax")))).status).toBe(400);
  });

  it("adds an opt-out for every channel by default, and an existing entry is returned as it is", async () => {
    const a = await json(await post(owner, C, { address: "+14155550177", reason: "Asked by letter" }));
    expect(a.body).toMatchObject({ channel: "all", source: "builder_api", reason: "Asked by letter", addressHint: "+14…77" });
    const again = await json(await post(owner, C, { address: "+14155550177" }));
    expect(again.body.optOutId).toBe(a.body.optOutId);
    expect((await json(await get(owner, C))).body.results).toHaveLength(4);
    expect((await json(await get(owner, `${C}/check?address=%2B14155550177&channel=email`))).body).toEqual({ blocked: true });
  });

  it("refuses a bad address or channel before any call, and passes the API's message for the rest", async () => {
    expect((await json(await post(owner, C, { address: "" }))).status).toBe(400);
    expect((await json(await post(owner, C, { address: "+14155550100", channel: "pigeon" }))).status).toBe(400);
    expect(calls("messaging.opt-out.add")).toHaveLength(0);
    const res = await json(await post(owner, C, { address: "sam@example.com", channel: "sms" }));
    expect(res).toMatchObject({ status: 400, body: { error: { message: "An email address can only be blocked on email or all." } } });
  });

  it("requests removal by handle and preserves the opt-out until approval, with server history", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const row = (await (await get(owner, C)).json()).results[0];
    const ok = await json(await post(owner, `${C}/remove`, { optOutId: row.optOutId }));
    expect(ok.body).toEqual({ status: "waiting_for_approval" });
    expect(calls("messaging.opt-out.remove")[0].body).toEqual({ optOutId: row.optOutId, confirm: true });
    expect((await (await get(owner, C)).json()).results).toHaveLength(3);
    expect(log).not.toHaveBeenCalled();
    const approval = [...fakeState().approvals.values()].find((a) => a.capability === "messaging.opt-out.remove")!;
    await post(owner, `/api/pramaan/approvals/${approval.id}/decide`, { decision: "approve" });
    expect((await (await get(owner, C)).json()).results).toHaveLength(2);
    const history = (await (await get(owner, `${C}?removed=true`)).json()).results;
    const completed = await (await fakePramaanFetch(`http://pramaan.fake/v1/jobs/${approval.id}`, { headers: { Authorization: "Bearer fake" } })).json();
    expect(completed.result).toEqual({ removed: 1 });
    expect(history[0]).toMatchObject({ optOutId: row.optOutId, removedBy: owner, removedAt: expect.any(String) });
  });

  it("keeps a recipient's unsubscribe even after a removal request is approved", async () => {
    const rows = (await (await get(owner, C)).json()).results;
    const ownChoice = rows.find((r: { source: string }) => r.source === "unsubscribe_link");
    await post(owner, `${C}/remove`, { optOutId: ownChoice.optOutId });
    const approval = [...fakeState().approvals.values()].find((a) => a.capability === "messaging.opt-out.remove")!;
    await post(owner, `/api/pramaan/approvals/${approval.id}/decide`, { decision: "approve" });
    const completed = await (await fakePramaanFetch(`http://pramaan.fake/v1/jobs/${approval.id}`, { headers: { Authorization: "Bearer fake" } })).json();
    expect(completed.result).toEqual({ removed: 0 });
    expect((await (await get(owner, C)).json()).results).toHaveLength(3);
  });

  it("filters on the service by hint, channel and source, and includes the actor", async () => {
    const added = await (await post(owner, C, { address: "one@example.com", channel: "email" })).json();
    expect(added.createdBy).toBe(owner);
    const page = await (await get(owner, `${C}?query=one&channel=email&source=builder_api`)).json();
    expect(page.results).toHaveLength(1);
    expect(page.results[0].optOutId).toBe(added.optOutId);
    expect((await post(owner, `${C}/remove`, { address: "one@example.com" })).status).toBe(400);
  });

  it("requires a signed recipient link and ignores substituted addresses", async () => {
    expect((await post(undefined, `${C}/unsubscribe`, { address: "victim@example.com" })).status).toBe(400);
    expect((await post(undefined, `${C}/unsubscribe`, { link: "https://elsewhere.example/unsubscribe/recipient_demo" })).status).toBe(400);
    expect((await post(undefined, `${C}/unsubscribe`, { link: "http://pramaan.fake/unsubscribe/forged" })).status).toBe(400);
    expect(await json(await post(undefined, `${C}/unsubscribe`, { link: "http://pramaan.fake/unsubscribe/recipient_demo", address: "victim@example.com" }))).toEqual({ status: 200, body: { ok: true } });
    expect((await (await get(owner, `${C}/check?address=recipient%40example.com&channel=email`)).json()).blocked).toBe(true);
    expect((await (await get(owner, `${C}/check?address=victim%40example.com&channel=email`)).json()).blocked).toBe(false);
  });

  it("pages the list with a cursor and passes the API's own error message through", async () => {
    const first = (await json(await get(owner, C))).body;
    expect(first.nextCursor).toBeUndefined();
    failNext("POST", "/v1/capabilities/messaging.opt-outs.list", 429, { code: "rate_limited", message: "Too many requests. Wait a minute, then try again." });
    expect(await json(await get(owner, C))).toMatchObject({ status: 429, body: { error: { message: "Too many requests. Wait a minute, then try again." } } });
  });
});
