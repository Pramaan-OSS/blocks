import { beforeEach, describe, expect, it } from "vitest";
import { completeFakeConnection, failNext, fakeState, resetFake } from "@/lib/pramaan/fake";
import { asMember, callRoute, get, post } from "./harness";

const C = "/api/pramaan/connections";
const owner = "mbr_owner";
beforeEach(() => resetFake());

const json = async (res: Response) => ({ status: res.status, body: await res.json() });
const as = (user: string, url: string, init: RequestInit = {}) => callRoute(asMember(undefined, url, { ...init, headers: { ...(init.headers as object), cookie: `pramaan_user=${user}` } }));
const states = async () => Object.fromEntries((await json(await get(owner, C))).body.connections.map((c: { app: string; status: string }) => [c.app, c.status]));

describe("connections routes", () => {
  it("lists the person's apps with plain statuses, and the workspace accounts", async () => {
    const { status, body } = await json(await get(owner, C));
    expect(status).toBe(200);
    expect(body.connections).toEqual([
      expect.objectContaining({ app: "gmail", status: "connected", state: "active", connectionId: "apn_gmail1", name: "pat@example.com", access: "read-write" }),
      expect.objectContaining({ app: "googlecalendar", status: "needs_reconnect", state: "expired", connectionId: "apn_cal1" }),
      expect.objectContaining({ app: "github", status: "revoked", state: "revoked" }),
    ]);
    expect(body.connections[2].connectionId).toBeUndefined();
    expect(body.accounts.map((a: { status: string }) => a.status)).toEqual(["connected", "connected", "disconnected"]);
    // Every call is for this person, by your own reference.
    const asked = fakeState().requests.filter((r) => r.path.startsWith("/v1/capabilities/apps."));
    expect(asked.map((r) => (r.body as { endUserRef: string }).endUserRef)).toEqual(["user-42", "user-42"]);
  });

  it("nobody signed in gets a plain answer and no call is made", async () => {
    process.env.PRAMAAN_FAKE = "";
    try {
      const res = await json(await get(undefined, C));
      expect(res).toMatchObject({ status: 401, body: { error: { message: "Sign in to see this." } } });
    } finally {
      process.env.PRAMAAN_FAKE = "1";
    }
    expect(fakeState().requests).toHaveLength(0);
  });

  it("refuses a user reference that is an email, before any call", async () => {
    const res = await json(await as("pat@example.com", C));
    expect(res.body.error.message).toContain("check its setup");
    expect(fakeState().requests).toHaveLength(0);
  });

  it("connect starts the sign-in with a return link back to this app; after sign-in it reads connected", async () => {
    const res = await json(await post(owner, `${C}/start`, { app: "outlook" }));
    expect(res.body.connectUrl).toContain("/api/demo/connect");
    const sent = fakeState().requests.find((r) => r.path.endsWith("apps.connection.start"))!;
    expect(sent.body).toEqual({ endUserRef: "user-42", app: "outlook", redirectUrl: "http://app.test/connections/return?app=outlook" });
    expect((await states()).outlook).toBe("pending");
    completeFakeConnection("user-42", "outlook");
    expect((await states()).outlook).toBe("connected");
    const one = (await json(await get(owner, `${C}?app=outlook`))).body.connections;
    expect(one).toHaveLength(1);
  });

  it("reconnect turns an expired connection pending, then connected", async () => {
    expect((await states()).googlecalendar).toBe("needs_reconnect");
    await post(owner, `${C}/start`, { app: "googlecalendar" });
    completeFakeConnection("user-42", "googlecalendar");
    expect((await states()).googlecalendar).toBe("connected");
  });

  it("only accepts an app id and a path on this app", async () => {
    expect((await json(await post(owner, `${C}/start`, { app: "Not An App" }))).status).toBe(400);
    const away = await json(await post(owner, `${C}/start`, { app: "gmail", returnPath: "https://evil.example/x" }));
    expect(away).toMatchObject({ status: 400, body: { error: { message: "The return page must be a path on this app, like /connections/return." } } });
    expect(fakeState().requests.some((r) => r.path.endsWith("apps.connection.start"))).toBe(false);
  });

  it("disconnect revokes the app; it then reads revoked", async () => {
    expect((await json(await post(owner, `${C}/revoke`, { app: "gmail" }))).body).toEqual({ status: "revoked", revoked: 1 });
    expect((await states()).gmail).toBe("revoked");
  });

  it("removing a connection sends confirm and waits for approval; it goes once approved", async () => {
    const res = await json(await post(owner, `${C}/delete`, { connectionId: "apn_cal1" }));
    expect(res.body).toEqual({ status: "waiting_for_approval" });
    expect(fakeState().requests.find((r) => r.path.endsWith("apps.connection.delete"))!.body).toMatchObject({ connectionId: "apn_cal1", confirm: true });
    expect((await states()).googlecalendar).toBe("needs_reconnect");
    const wait = (await json(await get(owner, "/api/pramaan/approvals"))).body.results.find((a: { capability: string }) => a.capability === "apps.connection.delete");
    await post(owner, `/api/pramaan/approvals/${wait.approval_id}/decide`, { decision: "approve" });
    expect((await states()).googlecalendar).toBeUndefined();
  });

  it("checks one connection with apps.connection.get", async () => {
    expect((await json(await get(owner, `${C}/apn_gmail1`))).body).toMatchObject({ status: "connected", name: "pat@example.com" });
    const missing = await json(await get(owner, `${C}/apn_nope`));
    expect(missing).toMatchObject({ status: 404, body: { error: { message: "We couldn't find that." } } });
  });

  it("passes the API's own error message through", async () => {
    failNext("GET", "/v1/accounts", 429, { code: "rate_limited", message: "Too many requests. Wait a minute, then try again." });
    const res = await json(await get(owner, C));
    expect(res).toMatchObject({ status: 429, body: { error: { code: "rate_limited", message: "Too many requests. Wait a minute, then try again." } } });
  });
});
