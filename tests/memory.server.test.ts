import { beforeEach, describe, expect, it } from "vitest";
import { addFakeMemory, failNext, fakePramaanFetch, fakeState, resetFake } from "@/lib/pramaan/fake";
import { asMember, callRoute, get, post } from "./harness";

const M = "/api/pramaan/memory";
const owner = "mbr_owner";
const viewer = "mbr_viewer";
beforeEach(() => resetFake());

const json = async (res: Response) => ({ status: res.status, body: await res.json() });
const as = (user: string, url: string, init: RequestInit = {}) =>
  callRoute(asMember(undefined, url, { ...init, headers: { ...(init.headers as object), cookie: `pramaan_user=${user}; pramaan_member=${owner}` } }));
const del = (url: string, user?: string) => (user ? as(user, url, { method: "DELETE" }) : callRoute(asMember(owner, url, { method: "DELETE" })));
const texts = async (res: Response) => (await res.json()).results.map((r: { text: string }) => r.text);
const approve = (id: string) => post(owner, `/api/pramaan/approvals/${id}/decide`, { decision: "approve" });
const pendingFor = (capability: string) => [...fakeState().approvals.values()].find((a) => a.capability === capability && a.status === "pending")!;

describe("memory routes", () => {
  it("lists only the signed-in person's memories, newest first, and ignores any user in the URL (an admin never reads another member's)", async () => {
    const { status, body } = await json(await get(owner, M));
    expect(status).toBe(200);
    expect(body.results).toHaveLength(5);
    expect(body.results[0].text).toBe("Is planning a trip to Lisbon in March.");
    expect(JSON.stringify(body)).not.toContain("Another person's");
    const sneaky = await texts(await get(owner, `${M}?user=user-7&scope=user-7`));
    expect(sneaky.join(" ")).not.toContain("Another person's");
    const asked = fakeState().requests.filter((r) => r.path.endsWith("memory.items.list"));
    for (const r of asked) expect((r.body as { scope: unknown }).scope).toEqual({ namespace: "assistant", user: "user-42" });
    // The other person has their own, and sees only theirs.
    expect(await texts(await as("user-7", M))).toEqual(["Another person's private note that nobody else should ever see."]);
  });

  it("searches by words, and pages with a cursor", async () => {
    expect(await texts(await get(owner, `${M}?q=lisbon`))).toEqual(["Is planning a trip to Lisbon in March."]);
    for (let i = 0; i < 8; i++) addFakeMemory(fakeState(), "user-42", `Extra memory ${i}`);
    const first = (await json(await get(owner, M))).body;
    expect(first.results).toHaveLength(10);
    expect(first.nextCursor).toBeTruthy();
    const second = (await json(await get(owner, `${M}?cursor=${first.nextCursor}`))).body;
    expect(second.results).toHaveLength(3);
    expect(second.nextCursor).toBeUndefined();
  });

  it("deleting one waits for approval, then it is gone and shows in the changes", async () => {
    const ref = (await json(await get(owner, `${M}?q=vegetarian`))).body.results[0].ref;
    const res = await json(await del(`${M}/${ref}`));
    expect(res.body).toEqual({ status: "waiting_for_approval" });
    expect(await texts(await get(owner, M))).toHaveLength(5);
    expect((await approve(pendingFor("memory.item.delete").id)).status).toBe(200);
    const left = await texts(await get(owner, M));
    expect(left).toHaveLength(4);
    expect(left.join(" ")).not.toContain("vegetarian");
    const changes = (await json(await get(owner, `${M}/changes`))).body.results;
    expect(changes[0]).toMatchObject({ event: "delete", text: "Is vegetarian and allergic to peanuts." });
    // The call carried the person and confirmation.
    const sent = fakeState().requests.find((r) => r.path.endsWith("memory.item.delete"))!;
    expect(sent.body).toMatchObject({ ref, confirm: true, scope: { user: "user-42" } });
  });

  it("can't delete someone else's memory, and a bad reference is refused before any call", async () => {
    const theirs = (await json(await as("user-7", M))).body.results[0].ref;
    const res = await json(await del(`${M}/${theirs}`));
    expect(res).toMatchObject({ status: 404, body: { error: { message: "No such memory. List them with memory.items.list." } } });
    fakeState().requests.length = 0;
    const bad = await json(await del(`${M}/nonsense`));
    expect(bad).toMatchObject({ status: 400, body: { error: { message: expect.stringContaining("isn't valid") } } });
    expect(fakeState().requests).toHaveLength(0);
  });

  it("forget everything waits for approval, then erases only this person's memories", async () => {
    expect((await json(await post(owner, `${M}/forget`))).body).toEqual({ status: "waiting_for_approval" });
    expect(await texts(await get(owner, M))).toHaveLength(5);
    await approve(pendingFor("memory.scope.delete").id);
    expect(await texts(await get(owner, M))).toEqual([]);
    expect(await texts(await as("user-7", M))).toHaveLength(1);
  });

  it("nobody signed in gets a plain answer and no call is made", async () => {
    process.env.PRAMAAN_FAKE = "";
    try {
      const res = await json(await get(undefined, M));
      expect(res).toMatchObject({ status: 401, body: { error: { message: "Sign in to see this." } } });
    } finally {
      process.env.PRAMAAN_FAKE = "1";
    }
    expect(fakeState().requests).toHaveLength(0);
  });

  it("shows the organisation queue to admins only, who approve, reject and acknowledge", async () => {
    const q = (await json(await get(owner, `${M}/org`))).body;
    expect(q.admin).toBe(true);
    expect(q.rows).toEqual([
      { id: "mi_org_cand1", text: expect.any(String), conflict: false },
      { id: "mi_org_cand2", text: expect.any(String), conflict: true },
    ]);
    expect(q.notices).toHaveLength(1);
    expect((await json(await get(viewer, `${M}/org`))).body).toEqual({ admin: false, rows: [], notices: [] });
    expect((await json(await get("none", `${M}/org`))).body.admin).toBe(false);

    const denied = await json(await post(viewer, `${M}/org/decide`, { id: "mi_org_cand1", action: "approve" }));
    expect(denied).toMatchObject({ status: 403, body: { error: { message: expect.stringContaining("Only workspace admins") } } });

    expect((await post(owner, `${M}/org/decide`, { id: "mi_org_cand1", action: "approve" })).status).toBe(200);
    expect((await post(owner, `${M}/org/decide`, { id: "mi_org_cand2", action: "reject" })).status).toBe(200);
    expect((await post(owner, `${M}/org/decide`, { id: "mi_org_auto1", action: "acknowledge" })).status).toBe(200);
    const after = (await json(await get(owner, `${M}/org`))).body;
    expect(after.rows).toEqual([]);
    expect(after.notices).toEqual([]);
    const wrong = await json(await post(owner, `${M}/org/decide`, { id: "mi_org_cand1", action: "reject" }));
    expect(wrong.body.error.message).toBe("Only candidates can be rejected. Use remove for org memory.");
    expect((await json(await post(owner, `${M}/org/decide`, { id: "x", action: "approve" }))).status).toBe(404);
  });

  it("reads the active member summary without accepting another user's scope", async () => {
    const profile = await (await get(owner, `${M}/profile?user=user-7`)).json();
    expect(profile.facts).toEqual([{ id: expect.any(String), text: "Prefers short, clear answers." }]);
    const sent = fakeState().requests.find((r) => r.path.endsWith("memory.member.profile.get"))!;
    expect(sent.body).toEqual({ scope: { user: owner } });
    expect(sent.headers["pramaan-member"]).toBe(owner);
    const read = (member: string, user: string) =>
      fakePramaanFetch("http://pramaan.fake/v1/capabilities/memory.member.profile.get", { method: "POST", headers: { Authorization: "Bearer fake", "Pramaan-Member": member, "Content-Type": "application/json" }, body: JSON.stringify({ scope: { user } }) });
    expect((await read(viewer, owner)).status).toBe(403);
    expect((await read(owner, owner)).status).toBe(200);
    expect((await get("none", `${M}/profile`)).status).toBe(401);
    await get(owner, `${M}/org`);
    expect(fakeState().requests.some((r) => r.path === "/v1/memory/admin/queue")).toBe(true);
    expect(fakeState().requests.some((r) => r.path.startsWith("/v1/internal/memory"))).toBe(false);
  });

  it("passes the API's own error message through", async () => {
    failNext("POST", "/v1/capabilities/memory.items.list", 429, { code: "rate_limited", message: "Too many requests. Wait a minute, then try again." });
    const res = await json(await get(owner, M));
    expect(res).toMatchObject({ status: 429, body: { error: { message: "Too many requests. Wait a minute, then try again." } } });
  });
});
