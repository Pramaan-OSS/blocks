import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetCrmFake } from "@/lib/pramaan/crm-data";
import { ownProfile, publicProfile, saveProfile, startProfilePhoto, finishProfilePhoto } from "@/lib/pramaan/profiles";
import { isBlocked, isHidden, moderate, moderationQueue, moderationAudit, checkNewText } from "@/lib/pramaan/moderation";
import { GET as profilesGet, POST as profilesPost } from "@/registry/profiles/app/api/pramaan/profiles/route";
import { GET as queueGet, POST as queuePost } from "@/registry/moderation/app/api/pramaan/moderation/route";
import { fakeState, resetFake } from "@/lib/pramaan/fake";
import * as server from "@/lib/pramaan/server";
import * as files from "@/lib/pramaan/upload";
import { mayModerate } from "@/lib/pramaan/social-context";
const scope = "demo";
const draft = (extra = {}) => ({ revision: 0, name: "Jamie", bio: "Private biography", links: ["https://example.com/"], public: { name: false, bio: false, links: false, photo: false }, ...extra });
const req = (body?: unknown, member = "mbr_owner", origin?: string) => new Request("http://app.test/api/pramaan/profiles", { method: body ? "POST" : "GET", headers: { cookie: `pramaan_member=${member}`, ...(body ? { "Content-Type": "application/json" } : {}), ...(origin ? { origin } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
beforeEach(() => { resetCrmFake(); resetFake(); vi.stubEnv("PRAMAAN_TEXT_SCREENING", ""); vi.stubEnv("PRAMAAN_SOCIAL_SCOPE", "demo"); });
describe("profiles", () => {
  it("starts private and never leaks private fields or storage references", async () => {
    await saveProfile(scope, "alice", draft());
    expect(await publicProfile(scope, "alice")).toEqual({});
    expect(await ownProfile(scope, "alice")).toMatchObject({ name: "Jamie", bio: "Private biography" });
  });
  it("publishes only selected fields", async () => {
    await saveProfile(scope, "alice", draft({ public: { name: true, bio: false, links: true, photo: false } }));
    expect(await publicProfile(scope, "alice")).toEqual({ name: "Jamie", links: ["https://example.com/"] });
  });
  it("rejects stale edits and keeps the winning version", async () => {
    await saveProfile(scope, "alice", draft());
    await expect(saveProfile(scope, "alice", draft({ name: "Stale" }))).rejects.toMatchObject({ status: 409 });
    expect((await ownProfile(scope, "alice")).name).toBe("Jamie");
  });
  it.each(["javascript:alert(1)", "http://example.com", "https://user:pass@example.com"])("rejects unsafe link %s", async link => {
    await expect(saveProfile(scope, "alice", draft({ links: [link] }))).rejects.toThrow();
  });
  it("cannot edit another person through submitted identity", async () => {
    const response = await profilesPost(req(draft({ person: "victim" })));
    expect(response.status).toBe(200);
    expect((await ownProfile(scope, "victim")).name).toBe("");
  });
  it("permits signed-in members to edit their own profiles", async () => {
    expect((await profilesPost(req(draft(), "mbr_viewer"))).status).toBe(200);
  });
  it("rejects signed-out edits and foreign origins", async () => {
    expect((await profilesPost(req(draft(), "none"))).status).toBe(401);
    expect((await profilesPost(req(draft(), "mbr_owner", "https://other.test"))).status).toBe(403);
  });
  it("guards public reads with rate limits", async () => {
    let response: Response | undefined;
    for (let i=0; i<601; i++) response = await profilesGet(new Request("http://app.test/api/pramaan/profiles?person=missing"));
    expect(response!.status).toBe(429);
  });
  it("counts writes against the address limit before calling the bot check", async () => {
    vi.stubEnv("PRAMAAN_BOT_CHECK_SECRET", "enabled");
    const check = vi.spyOn(server, "capability").mockResolvedValue({ passed: false });
    try {
      let response: Response | undefined;
      for (let i = 0; i < 11; i++) {
        const request = req({ ...draft(), botCheckToken: "token" });
        request.headers.set("x-forwarded-for", "203.0.113.9");
        response = await profilesPost(request);
      }
      expect(response!.status).toBe(429);
      expect(check).toHaveBeenCalledTimes(10);
    } finally { check.mockRestore(); }
  });
  it("requires the configured bot check for writes", async () => {
    vi.stubEnv("PRAMAAN_BOT_CHECK_SECRET", "enabled");
    expect((await profilesPost(req(draft()))).status).toBe(400);
  });
  it("does not accept another person's photo reference", async () => {
    const link = await startProfilePhoto(scope, "alice", { contentType: "image/png", sizeBytes: 10 });
    await expect(finishProfilePhoto(scope, "bob", link.fileId)).rejects.toMatchObject({ status: 403 });
  });
  it.each(["image/svg+xml", "text/html"])("rejects unsafe photo type %s", async contentType => {
    await expect(startProfilePhoto(scope, "alice", { contentType, sizeBytes: 10 })).rejects.toThrow();
  });
  it("checks the finished photo's real size and removes rejected or replaced files", async () => {
    const stored = (fileId: string, sizeBytes = 10) => ({ fileId, kind: "image" as const, contentType: "image/png", sizeBytes, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), url: `https://files.test/${fileId}` });
    const remove = vi.spyOn(files, "deleteUpload").mockResolvedValue({ deleted: true });
    const finish = vi.spyOn(files, "finishUpload");
    const upload = async (sizeBytes?: number) => {
      const link = await startProfilePhoto(scope, "alice", { contentType: "image/png", sizeBytes: 10 });
      finish.mockResolvedValueOnce(stored(link.fileId, sizeBytes));
      return link.fileId;
    };
    try {
      const big = await upload(6_000_000);
      await expect(finishProfilePhoto(scope, "alice", big)).rejects.toThrow("under 5 MB");
      expect(remove).toHaveBeenCalledWith(big);
      expect((await ownProfile(scope, "alice")).photo).toBeUndefined();
      const first = await upload(); await finishProfilePhoto(scope, "alice", first);
      const second = await upload(); await finishProfilePhoto(scope, "alice", second);
      expect(remove).toHaveBeenLastCalledWith(first);
      expect((await ownProfile(scope, "alice")).photo?.fileId).toBe(second);
    } finally { remove.mockRestore(); finish.mockRestore(); }
  });
  it("rejects oversized photos and incomplete uploads", async () => {
    await expect(startProfilePhoto(scope, "alice", { contentType: "image/png", sizeBytes: 5_000_001 })).rejects.toThrow();
    const link = await startProfilePhoto(scope, "alice", { contentType: "image/png", sizeBytes: 10 });
    await expect(finishProfilePhoto(scope, "alice", link.fileId)).rejects.toThrow();
  });
});
describe("moderation", () => {
  const report = { action: "report", kind: "item", ref: "post-one", reason: "Spam links" };
  it("reports once, hides only after review, and records the trusted actor and time", async () => {
    await moderate(scope, "member", report); await moderate(scope, "member", report);
    const data = await moderationQueue(scope); expect(data.reports).toHaveLength(1);
    expect(await isHidden("post-one", scope)).toBe(false);
    await moderate(scope, "mbr_owner", { action: "hide", id: data.reports[0].id, by: "forged" });
    expect(await isHidden("post-one", scope)).toBe(true);
    const [decided] = (await moderationQueue(scope)).reports;
    expect(decided).toMatchObject({ status: "hidden", decidedAt: expect.any(String) });
    expect(await moderationAudit(scope)).toEqual([{ action: "hide", by: "mbr_owner", at: decided.decidedAt, target: { kind: "item", ref: "post-one" } }]);
  });
  it("sends reviewers only the reports, without block lists or member references", async () => {
    await moderate(scope, "member", report);
    await moderate(scope, "bob", { action: "block", ref: "alice" });
    const body = await (await queueGet(req(undefined, "mbr_owner"))).json();
    expect(Object.keys(body)).toEqual(["reports"]);
    expect(JSON.stringify(body)).not.toMatch(/bob|alice|"member"|post-one/);
  });
  it("tells reviewers whether they or another moderator decided, without member references", async () => {
    await moderate(scope, "member", report);
    await moderate(scope, "mbr_admin", { action: "dismiss", id: (await moderationQueue(scope)).reports[0].id });
    const reviewer = async (member: string) => (await (await queueGet(req(undefined, member))).json()).reports[0];
    expect(await reviewer("mbr_owner")).toMatchObject({ reviewer: "another moderator" });
    expect(await reviewer("mbr_admin")).toMatchObject({ reviewer: "you" });
    expect(JSON.stringify(await reviewer("mbr_owner"))).not.toContain("mbr_");
  });
  it("denies non-moderators queue access and decisions", async () => {
    expect((await queueGet(req(undefined, "mbr_viewer"))).status).toBe(403);
    expect((await queuePost(req({ action: "hide", id: "missing" }, "mbr_viewer"))).status).toBe(403);
    expect((await queueGet(req(undefined, "none"))).status).toBe(401);
  });
  it("allows owners and admins only in the fake; production denies until wired", async () => {
    expect(await mayModerate("mbr_admin", scope)).toBe(true);
    vi.stubEnv("PRAMAAN_FAKE", "0"); expect(await mayModerate("mbr_owner", scope)).toBe(false); vi.stubEnv("PRAMAAN_FAKE", "1");
  });
  it("dismisses without hiding and rejects repeat decisions", async () => {
    await moderate(scope, "member", report);
    const id = (await moderationQueue(scope)).reports[0].id;
    await moderate(scope, "mbr_admin", { action: "dismiss", id });
    expect(await isHidden("post-one", scope)).toBe(false);
    await expect(moderate(scope, "mbr_owner", { action: "hide", id })).rejects.toMatchObject({ status: 409 });
  });
  it("blocks directionally and hides the profile for that viewer only", async () => {
    await saveProfile(scope, "alice", draft());
    await moderate(scope, "bob", { action: "block", ref: "alice" });
    expect(await isBlocked("bob", "alice", scope)).toBe(true);
    expect(await isBlocked("alice", "bob", scope)).toBe(false);
    await expect(publicProfile(scope, "alice", "bob")).rejects.toMatchObject({ status: 404 });
    expect(await publicProfile(scope, "alice", "charlie")).toEqual({});
    await moderate(scope, "bob", { action: "unblock", ref: "alice" });
    expect(await isBlocked("bob", "alice", scope)).toBe(false);
  });
  it("shows nothing of a profile to a person its owner blocked", async () => {
    await saveProfile(scope, "alice", draft({ public: { name: true, bio: true, links: true, photo: true } }));
    await moderate(scope, "alice", { action: "block", ref: "bob" });
    await expect(publicProfile(scope, "alice", "bob")).rejects.toMatchObject({ status: 404, message: "This profile isn't available." });
    expect(await publicProfile(scope, "alice", "charlie")).toMatchObject({ name: "Jamie" });
  });
  it("isolates workspaces", async () => {
    await moderate(scope, "member", report); expect((await moderationQueue("elsewhere")).reports).toHaveLength(0);
  });
  it("requires a reason, valid target and another person for blocking", async () => {
    await expect(moderate(scope, "member", { ...report, reason: "" })).rejects.toThrow();
    await expect(moderate(scope, "member", { ...report, kind: "unknown" })).rejects.toThrow();
    await expect(moderate(scope, "member", { action: "block", ref: "member" })).rejects.toThrow();
  });
  it("does not call classification unless the owner enables it", async () => {
    await checkNewText(scope, { kind: "item", ref: "one" }, "spam");
    expect(fakeState().requests).toHaveLength(0);
  });
  it("automatically reports flagged text without hiding or deleting it", async () => {
    vi.stubEnv("PRAMAAN_TEXT_SCREENING", "1");
    await saveProfile(scope, "alice", draft({ bio: "spam" }));
    expect((await ownProfile(scope, "alice")).bio).toBe("spam");
    expect((await moderationQueue(scope)).reports[0]).toMatchObject({ automatic: true, status: "open", kind: "person", subject: { href: "/profiles/alice" } });
    expect(await isHidden("alice", scope)).toBe(false);
    expect(fakeState().requests[0]).toMatchObject({ path: "/v1/capabilities/text.classify", body: { text: "Jamie\nspam" } });
  });
  it("lets explicit safe results through and queues failures for human review", async () => {
    vi.stubEnv("PRAMAAN_TEXT_SCREENING", "1");
    await checkNewText(scope, { kind: "item", ref: "safe" }, "Welcome");
    expect((await moderationQueue(scope)).reports).toHaveLength(0);
    fakeState().failures.push({ method: "POST", path: "/v1/capabilities/text.classify", status: 503, error: { code: "unavailable", message: "private upstream detail" } });
    await checkNewText(scope, { kind: "item", ref: "failed" }, "Welcome");
    expect((await moderationQueue(scope)).reports[0].reason).not.toContain("private");
  });
});

it.each([
  { primaryCategory: "sports", confidence: 0.99 },
  { primaryCategory: "safe", confidence: 95 },
  { status: "running", job_id: "private-reference" },
])("queues uncertain classification without exposing remote details: %j", async result => {
  vi.stubEnv("PRAMAAN_TEXT_SCREENING", "1");
  const spy = vi.spyOn(server, "capability").mockResolvedValue(result);
  try {
    await checkNewText(scope, { kind: "item", ref: "uncertain" }, "Welcome");
    expect((await moderationQueue(scope)).reports[0]).toMatchObject({ automatic: true, reason: "Automatic text check needs a review." });
  } finally { spy.mockRestore(); }
});
