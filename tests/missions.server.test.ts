import { beforeEach, describe, expect, it } from "vitest";
import { failNext, fakeState, resetFake } from "@/lib/pramaan/fake";
import { platform } from "@/lib/pramaan/fake-platform";
import { get, post, useClock } from "./harness";

let time: ReturnType<typeof useClock>;
beforeEach(() => {
  resetFake();
  time = useClock(fakeState());
});

const research = { input: { domain: "example.com" } };
const estimateOf = async (id: string, body: unknown) => (await post("mbr_owner", `/api/pramaan/missions/${id}/estimate`, body)).json();
const start = async (id: string, body: unknown, key = crypto.randomUUID()) =>
  post("mbr_owner", `/api/pramaan/missions/${id}/run`, body, { "Idempotency-Key": key });
const jobOf = async (id: string) => (await get("mbr_owner", `/api/pramaan/jobs/${id}`)).json();

describe("mission routes", () => {
  it("lists missions and describes one with its input schema and steps", async () => {
    const list = await (await get(undefined, "/api/pramaan/missions")).json();
    expect(list.results.map((m: { id: string }) => m.id)).toEqual(["company.research", "broadcast.send"]);
    const one = await (await get(undefined, "/api/pramaan/missions/company.research")).json();
    expect(one.input_schema.properties).toHaveProperty("domain");
    expect(one.steps.map((s: { capability: string }) => s.capability)).toEqual(["companies.registry.search", "companies.news", "web.read", "llm.complete"]);
  });

  it("estimates before it starts: the most it can cost, the steps, and what is still missing", async () => {
    const ok = await estimateOf("company.research", research);
    expect(ok).toMatchObject({ ready: true, can_run: true, price_max_micro: 210_000 });
    expect(ok.steps).toHaveLength(4);
    const missing = await estimateOf("company.research", { input: {} });
    expect(missing).toMatchObject({ ready: false, message: "Send a domain or a name for the company." });
  });

  it("start carries the plan and one idempotency key; a repeat returns the same job", async () => {
    const { plan } = await estimateOf("company.research", research);
    const a = await start("company.research", { ...research, plan }, "key-1");
    const b = await start("company.research", { ...research, plan }, "key-1");
    expect(a.status).toBe(202);
    expect((await a.json()).job_id).toBe((await b.json()).job_id);
    expect(platform(fakeState()).jobs.size).toBe(1);
    const sent = fakeState().requests.filter((r) => r.method === "POST" && r.path === "/v1/outcomes/company.research");
    expect(sent[0].headers["idempotency-key"]).toBe("key-1");
    expect(sent[0].headers["pramaan-plan"]).toBe(plan);
  });

  it("a mission that needs approval is refused without the plan the person saw", async () => {
    const input = { accountId: "acc_sms1", name: "Launch", text: "We launched." };
    const res = await start("broadcast.send", { input });
    expect(res.status).toBe(403);
    expect((await res.json()).error.message).toMatch(/needs approval/);
  });

  it("shows each step as the run moves, then the result and what it cost", async () => {
    const { plan } = await estimateOf("company.research", research);
    const { job_id } = await (await start("company.research", { ...research, plan })).json();
    let j = await jobOf(job_id);
    expect(j.progress.steps.map((s: { status: string }) => s.status)).toEqual(["running", "waiting", "waiting", "waiting"]);
    time.advance(2_500);
    j = await jobOf(job_id);
    expect(j.progress.steps.map((s: { status: string }) => s.status)).toEqual(["done", "done", "running", "waiting"]);
    expect(j.progress.charged_micro).toBe(70_000);
    time.advance(5_000);
    j = await jobOf(job_id);
    expect(j.status).toBe("done");
    expect(j.result.result.company).toBe("example.com");
    expect(j.result.cost).toMatchObject({ hold_micro: 210_000, charged_micro: 210_000 });
    expect(fakeState().holds.size).toBe(0);
  });

  it("cancel stops new steps; you pay only for work done, never more than the estimate", async () => {
    const { plan } = await estimateOf("company.research", research);
    const { job_id } = await (await start("company.research", { ...research, plan })).json();
    time.advance(1_500);
    const res = await post("mbr_owner", `/api/pramaan/jobs/${job_id}/cancel`);
    const ended = await res.json();
    expect(ended.status).toBe("cancelled");
    expect(ended.result.cost.charged_micro).toBe(20_000);
    expect(ended.result.cost.charged_micro).toBeLessThanOrEqual(ended.result.cost.hold_micro);
    expect(ended.progress.steps.map((s: { status: string }) => s.status)).toEqual(["done", "skipped", "skipped", "skipped"]);
    expect(fakeState().holds.size).toBe(0);
    time.advance(10_000);
    expect((await jobOf(job_id)).progress.charged_micro).toBe(20_000);
    const again = await post("mbr_owner", `/api/pramaan/jobs/${job_id}/cancel`);
    expect(again.status).toBe(409);
  });

  it("a step that needs a yes waits in the approvals inbox and the run resumes after the decision", async () => {
    const input = { accountId: "acc_sms1", name: "Launch", text: "We launched." };
    const { plan } = await estimateOf("broadcast.send", { input });
    const { job_id } = await (await start("broadcast.send", { input, plan })).json();
    time.advance(5_000);
    let j = await jobOf(job_id);
    const send = j.progress.steps.find((s: { id: string }) => s.id === "send");
    expect(send.status).toBe("waiting_approval");
    const inbox = await (await get("mbr_owner", "/api/pramaan/approvals")).json();
    expect(inbox.results.some((a: { approval_id: string }) => a.approval_id === send.approval_id)).toBe(true);
    expect(j.status).toBe("running");

    const decided = await post("mbr_owner", `/api/pramaan/approvals/${send.approval_id}/decide`, { decision: "approve" });
    expect(decided.status).toBe(200);
    time.advance(2_000);
    j = await jobOf(job_id);
    expect(j.status).toBe("done");
    expect(j.result.cost.charged_micro).toBe(100_000);
  });

  it("a declined step ends the run with the API's own message", async () => {
    const input = { accountId: "acc_sms1", name: "Launch", text: "We launched." };
    const { plan } = await estimateOf("broadcast.send", { input });
    const { job_id } = await (await start("broadcast.send", { input, plan })).json();
    time.advance(5_000);
    const j = await jobOf(job_id);
    const id = j.progress.steps.find((s: { id: string }) => s.id === "send").approval_id;
    await post("mbr_owner", `/api/pramaan/approvals/${id}/decide`, { decision: "deny" });
    const after = await jobOf(job_id);
    expect(after.status).toBe("failed");
    expect(after.error.message).toMatch(/declined this step/);
    expect(after.result.cost.charged_micro).toBe(10_000);
  });

  it("a low balance refuses the start and carries where to add credit", async () => {
    platform(fakeState()).balanceMicro = 50_000;
    const est = await estimateOf("company.research", research);
    expect(est).toMatchObject({ can_run: false });
    expect(est.top_up.links[0].url).toContain("/settings/wallet");
    const res = await start("company.research", { ...research, plan: est.plan });
    expect(res.status).toBe(402);
    const { error } = await res.json();
    expect(error.code).toBe("spend_cap_reached");
    expect(error.top_up.links[0].label).toBe("Add credit");
  });

  it("passes the API's own error message through", async () => {
    failNext("GET", "/v1/jobs/job_gone", 404, { code: "job_not_found", message: "No job with that id. It may belong to another workspace." });
    const res = await get("mbr_owner", "/api/pramaan/jobs/job_gone");
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatchObject({ code: "job_not_found", message: "No job with that id. It may belong to another workspace." });
  });
});
