import { beforeEach, describe, expect, it } from "vitest";
import { GET as list } from "@/registry/approvals/app/api/pramaan/approvals/route";
import { GET as getOne } from "@/registry/approvals/app/api/pramaan/approvals/[id]/route";
import { POST as decide } from "@/registry/approvals/app/api/pramaan/approvals/[id]/decide/route";
import { addFakeApproval, decideElsewhere, failNext, fakeState, resetFake } from "@/lib/pramaan/fake";
import { asMember } from "./harness";

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const decideAs = (member: string | undefined, id: string, decision: string, key = crypto.randomUUID()) =>
  decide(
    asMember(member, `/api/pramaan/approvals/${id}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify({ decision }),
    }),
    params(id),
  );

beforeEach(() => {
  resetFake();
});

describe("approvals routes", () => {
  it("lists pending approvals with the viewer resolved from GET /v1/members", async () => {
    const res = await list(asMember("mbr_owner", "/api/pramaan/approvals"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.results).toHaveLength(2);
    expect(body.viewer).toEqual({ memberId: "mbr_owner", canApprove: true });
    const viewer = await (await list(asMember("mbr_viewer", "/api/pramaan/approvals"))).json();
    expect(viewer.viewer).toEqual({ memberId: "mbr_viewer", canApprove: false });
    const nobody = await (await list(asMember("none", "/api/pramaan/approvals"))).json();
    expect(nobody.viewer).toEqual({ canApprove: false });
  });

  it("approve runs once, with an idempotency key, and a second decision does not run it again", async () => {
    const id = addFakeApproval({ capability: "email.send", input: { to: "a@example.com" } });
    const first = await decideAs("mbr_owner", id, "approve", "key-1");
    expect(first.status).toBe(200);
    expect((await first.json()).status).toBe("approved");
    const second = await decideAs("mbr_owner", id, "approve", "key-2");
    expect(second.status).toBe(409);
    expect((await second.json()).error.message).toBe("This approval was already decided, or it has expired.");
    expect(fakeState().approvals.get(id)?.runs).toBe(1);
    const sent = fakeState().requests.filter((r) => r.path === `/v1/approvals/${id}/decide`);
    expect(sent.map((r) => r.headers["idempotency-key"])).toEqual(["key-1", "key-2"]);
    expect(sent[0].headers["pramaan-member"]).toBe("mbr_owner");
  });

  it("an expired item cannot be approved", async () => {
    const id = addFakeApproval({
      capability: "sms.send",
      input: { to: "+15555550100" },
      createdAt: Date.now() - 2 * 86_400_000,
      expiresAt: Date.now() - 1_000,
    });
    const res = await decideAs("mbr_owner", id, "approve");
    expect(res.status).toBe(409);
    expect(fakeState().approvals.get(id)?.runs).toBe(0);
    const detail = await (await getOne(asMember("mbr_owner", `/api/pramaan/approvals/${id}`), params(id))).json();
    expect(detail.approval.state).toBe("expired");
  });

  it("an item another member already decided shows as decided and is not approved again", async () => {
    const id = addFakeApproval({ capability: "email.send", input: {} });
    decideElsewhere(id, "approved");
    const res = await decideAs("mbr_owner", id, "approve");
    expect(res.status).toBe(409);
    expect(fakeState().approvals.get(id)?.runs).toBe(1);
    const detail = await (await getOne(asMember("mbr_owner", `/api/pramaan/approvals/${id}`), params(id))).json();
    expect(detail.approval.state).toBe("approved");
  });

  it("a member who may not approve is refused on the server, before Pramaan is asked", async () => {
    const id = addFakeApproval({ capability: "email.send", input: {} });
    const res = await decideAs("mbr_viewer", id, "approve");
    expect(res.status).toBe(403);
    expect(fakeState().requests.some((r) => r.path.endsWith("/decide"))).toBe(false);
  });

  it("detail carries the exact inputs, maximum price and expected effect", async () => {
    const id = addFakeApproval({ capability: "email.send", priceMicro: 905_219, input: { to: "x@example.com", subject: "Hi" } });
    const { approval } = await (await getOne(asMember("mbr_owner", `/api/pramaan/approvals/${id}`), params(id))).json();
    expect(approval.input).toEqual({ to: "x@example.com", subject: "Hi" });
    expect(approval.price_micro).toBe(905_219);
    expect(approval.effect).toEqual({ description: "Sends one email from your connected inbox.", irreversible: true });
  });

  it("passes the API's own error message through", async () => {
    failNext("GET", "/v1/approvals", 429, { code: "rate_limited", message: "Too many requests. Wait a minute, then try again." });
    const res = await list(asMember("mbr_owner", "/api/pramaan/approvals"));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatchObject({ code: "rate_limited", message: "Too many requests. Wait a minute, then try again." });
  });

  it("without a key or the fake, says Pramaan needs connecting and makes no call", async () => {
    process.env.PRAMAAN_FAKE = "";
    const before = process.env.PRAMAAN_API_KEY;
    delete process.env.PRAMAAN_API_KEY;
    try {
      const res = await list(asMember(undefined, "/api/pramaan/approvals"));
      expect(res.status).toBe(503);
      expect((await res.json()).error).toEqual({
        code: "connection_required",
        message: "Pramaan isn't connected yet.",
        next: "Ask whoever runs this app to check its setup.",
      });
    } finally {
      process.env.PRAMAAN_FAKE = "1";
      if (before !== undefined) process.env.PRAMAAN_API_KEY = before;
    }
  });
});
