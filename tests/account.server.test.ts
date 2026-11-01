import { beforeEach, describe, expect, it } from "vitest";
import { failNext, fakeState, resetFake } from "@/lib/pramaan/fake";
import { asMember, callRoute, get } from "./harness";

const ACCOUNT = "/api/pramaan/account";
const ORG = "/api/pramaan/account/organisation";
const owner = "mbr_owner";
const viewer = "mbr_viewer";

beforeEach(() => resetFake());

const put = (member: string | undefined, body: unknown) =>
  callRoute(asMember(member, ORG, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
const orgWrites = () => fakeState().requests.filter((r) => r.method === "PUT");

describe("account routes", () => {
  it("an owner sees who they are, the organisation name and the whole team, with no member ids", async () => {
    fakeState().members.push({ member_id: "mbr_ana", email: "ana@example.com", role: "member", can_approve: false, may_approve: false, spend_limit: { limit_micro: 5_000_000, period: "day" } } as never);
    const res = await get(owner, ACCOUNT);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ you: { email: "owner@example.com", role: "owner", mayApprove: true, isYou: true }, organisationName: null, canEditName: true });
    expect(body.team.map((m: { email: string; isYou: boolean }) => [m.email, m.isYou])).toEqual([["owner@example.com", true], ["viewer@example.com", false], ["ana@example.com", false]]);
    expect(body.team[2].spendLimit).toEqual({ limitMicro: 5_000_000, period: "day" });
    expect(JSON.stringify(body)).not.toMatch(/mbr_/);
  });

  it("a viewer sees themselves and the name, but no team and no edit", async () => {
    const body = await (await get(viewer, ACCOUNT)).json();
    expect(body).toMatchObject({ you: { role: "viewer", isYou: true }, canEditName: false });
    expect(body.team).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("owner@example.com");
  });

  it("nobody signed in gets a plain answer and no call", async () => {
    const res = await get("none", ACCOUNT);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe("Sign in to see this.");
    expect((await put("none", { name: "Acme" })).status).toBe(401);
    expect(fakeState().requests.filter((r) => r.path === "/v1/organization")).toHaveLength(0);
  });

  it("an owner renames the organisation, tidied and recorded", async () => {
    const res = await put(owner, { name: "  Acme   Ltd " });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ organisationName: "Acme Ltd" });
    expect(orgWrites()[0].body).toEqual({ name: "Acme Ltd" });
    expect((await (await get(owner, ACCOUNT)).json()).organisationName).toBe("Acme Ltd");
  });

  it("a viewer can't rename, and nothing is sent", async () => {
    const res = await put(viewer, { name: "Acme" });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe("Only an owner or an admin can change the organisation's name.");
    expect(orgWrites()).toHaveLength(0);
  });

  it("a bad name is refused before any call; the API's own rules pass through", async () => {
    for (const body of [{ name: "A" }, { name: "x".repeat(201) }, { name: 5 }, {}]) expect((await put(owner, body)).status, JSON.stringify(body)).toBe(400);
    expect(orgWrites()).toHaveLength(0);
    const res = await put(owner, { name: "mail me@acme.com" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe("The name can't contain an email address.");
  });

  it("passes the API's message through when the account can't load", async () => {
    failNext("GET", "/v1/organization", 502, { code: "upstream_unavailable", message: "Pramaan is busy. Try again." });
    const res = await get(owner, ACCOUNT);
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe("Pramaan is busy. Try again.");
  });

  it("links to the dashboard only when you set where it is", async () => {
    expect((await (await get(owner, ACCOUNT)).json()).dashboardUrl).toBeUndefined();
    process.env.PRAMAAN_DASHBOARD_URL = "https://example.com/dashboard";
    try {
      expect((await (await get(owner, ACCOUNT)).json()).dashboardUrl).toBe("https://example.com/dashboard");
    } finally {
      delete process.env.PRAMAAN_DASHBOARD_URL;
    }
  });
});
