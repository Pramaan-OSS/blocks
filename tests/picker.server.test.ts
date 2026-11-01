import { beforeEach, describe, expect, it } from "vitest";
import { failNext, fakeState, resetFake } from "@/lib/pramaan/fake";
import { get, post } from "./harness";

const P = "/api/pramaan/picker";
beforeEach(() => resetFake());

const json = async (res: Response) => ({ status: res.status, body: await res.json() });
const names = (body: { results: { name: string }[] }) => body.results.map((r) => r.name);

describe("picker routes", () => {
  it("searches in plain words and shows plain names with a price", async () => {
    const { body } = await json(await get(undefined, `${P}?q=text%20message`));
    expect(names(body)[0]).toBe("Send a text message");
    expect(body.results[0]).toMatchObject({ id: "sms.send", kind: "action", priceMicro: 9_100, needsApproval: true });
    const web = await json(await get(undefined, `${P}?q=web`));
    expect(names(web.body)).toEqual(["Search the web", "Read a web page"]);
    const all = await json(await get(undefined, P));
    expect(all.body.results.length).toBeGreaterThanOrEqual(7);
  });

  it("finds missions too, marked as missions", async () => {
    const { body } = await json(await get(undefined, `${P}?q=research%20company`));
    expect(body.results.find((r: { kind: string }) => r.kind === "mission")).toMatchObject({ id: "company.research", name: "Research a company" });
  });

  it("asks one question when the words fit several actions about equally", async () => {
    const { body } = await json(await get(undefined, `${P}?q=send`));
    expect(body.clarify).toEqual({
      question: "Do you want to send an email or a text message?",
      options: [{ id: "email.send", label: "Send an email" }, { id: "sms.send", label: "Send a text message" }],
    });
    expect((await json(await get(undefined, `${P}?q=send%20an%20email`))).body.clarify).toBeUndefined();
  });

  it("says which words nothing matched", async () => {
    const { body } = await json(await get(undefined, `${P}?q=quuxglorp`));
    expect(body).toMatchObject({ results: [], missed: ["quuxglorp"] });
  });

  it("describes an action with its form fields, and a mission with its steps", async () => {
    const a = (await json(await get(undefined, `${P}/sms.send?kind=action`))).body;
    expect(a.inputSchema.required).toEqual(["to", "text"]);
    const m = (await json(await get(undefined, `${P}/company.research?kind=mission`))).body;
    expect(m.steps).toHaveLength(4);
    expect(m.steps[0]).toMatchObject({ label: "Look up the company register" });
  });

  it("shows the price before anything runs, and what is still missing", async () => {
    const ok = (await json(await post(undefined, `${P}/web.search/estimate`, { input: { query: "pramaan" } }))).body;
    expect(ok).toMatchObject({ priceMaxMicro: 5_000, ready: true, canRun: true });
    const missing = (await json(await post(undefined, `${P}/web.search/estimate`, { input: {} }))).body;
    expect(missing).toMatchObject({ ready: false, canRun: false, message: "query is required: what to search for." });
    expect(fakeState().requests.filter((r) => r.method === "POST" && /web\.search$/.test(r.path))).toHaveLength(0);
  });

  it("runs a read-only action at once and returns its result", async () => {
    const { status, body } = await json(await post(undefined, `${P}/web.search/run`, { input: { query: "pramaan" } }));
    expect(status).toBe(200);
    expect(body.status).toBe("done");
    expect(body.result.results[0].title).toContain("pramaan");
  });

  it("an action that sends waits for approval, once per click, and runs once after the yes", async () => {
    const input = { to: "+15555550123", text: "Your table is ready." };
    const key = { "Idempotency-Key": "click-1" };
    const a = await json(await post("mbr_owner", `${P}/sms.send/run`, { input }, key));
    const b = await json(await post("mbr_owner", `${P}/sms.send/run`, { input }, key));
    expect(a.body).toEqual({ status: "waiting_for_approval" });
    expect(b.body).toEqual({ status: "waiting_for_approval" });
    const mine = [...fakeState().approvals.values()].filter((x) => x.capability === "sms.send" && JSON.stringify(x.input) === JSON.stringify(input));
    expect(mine).toHaveLength(1);
    expect(mine[0].status).toBe("pending");
    expect(mine[0].runs).toBe(0);
    expect((await post("mbr_owner", `/api/pramaan/approvals/${mine[0].id}/decide`, { decision: "approve" })).status).toBe(200);
    expect(mine[0].runs).toBe(1);
  });

  it("refuses a missing field in the API's words, and a bad id before any call", async () => {
    const res = await json(await post(undefined, `${P}/sms.send/run`, { input: { to: "+1555" } }));
    expect(res).toMatchObject({ status: 400, body: { error: { message: "text is required: the message." } } });
    fakeState().requests.length = 0;
    const bad = await json(await post(undefined, `${P}/..%2Fx/run`, { input: {} }));
    expect(bad.status).toBe(400);
    expect(fakeState().requests).toHaveLength(0);
  });

  it("passes the API's own error message through", async () => {
    failNext("GET", "/v1/capabilities", 429, { code: "rate_limited", message: "Too many requests. Wait a minute, then try again." });
    const res = await json(await get(undefined, P));
    expect(res).toMatchObject({ status: 429, body: { error: { message: "Too many requests. Wait a minute, then try again." } } });
  });
});
