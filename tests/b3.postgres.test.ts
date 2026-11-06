import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { flushAfter } from "./next-server";
import { closeCrmDatabase } from "@/lib/pramaan/crm-data";
import { feedAction, homeFeed, personFeed, postComments, type FeedPost } from "@/lib/pramaan/feed";
import { conversationList, messagingAction, thread } from "@/lib/pramaan/messaging";
import { isBlocked, moderate, moderationQueue, reportTarget } from "@/lib/pramaan/moderation";
import { saveProfile } from "@/lib/pramaan/profiles";
import * as context from "@/lib/pramaan/social-context";
import * as files from "@/lib/pramaan/upload";
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("B3 real Postgres", () => {
  const scope = `b3-${randomUUID()}`;
  let db: ReturnType<typeof postgres>;
  const post = (member: string, text = "Hello", extra = {}) => feedAction(scope, member, { action: "post", text, ...extra }) as Promise<FeedPost>;
  const open = async (member: string, person: string) => (await messagingAction(scope, member, { action: "start", person }) as { id: string }).id;
  beforeAll(async () => {
    vi.stubEnv("PRAMAAN_FAKE", "0"); vi.stubEnv("PRAMAAN_TEXT_SCREENING", ""); vi.stubEnv("PRAMAAN_MESSAGE_EMAIL", ""); vi.stubEnv("DATABASE_URL", url!);
    vi.spyOn(context, "mayModerate").mockImplementation(async member => member === "owner");
    db = postgres(url!, { max: 5, prepare: false });
    // Apply every numbered migration in order, twice, as an installed host would.
    for (const block of ["profiles", "moderation", "feed", "messaging"]) {
      const dir = `registry/${block}/src/db/migrations`;
      for (const file of (await readdir(dir)).sort()) {
        const sql = await readFile(`${dir}/${file}`, "utf8");
        await db.unsafe(sql); await db.unsafe(sql);
      }
    }
  });
  afterAll(async () => {
    try {
      for (const table of ["crm_message", "crm_conversation", "crm_comment", "crm_post", "crm_follow", "crm_feed_upload", "crm_moderation_audit", "crm_report", "crm_block", "crm_hidden_item", "crm_profile"]) await db.unsafe(`delete from ${table} where scope = $1`, [scope]);
    } finally { await closeCrmDatabase(); await db?.end(); vi.restoreAllMocks(); vi.unstubAllEnvs(); }
  });
  it("pages a home feed in one query per page, leaving out blocked people and hidden posts without gaps", async () => {
    await feedAction(scope, "reader", { action: "follow", person: "friend" });
    await feedAction(scope, "reader", { action: "follow", person: "rude" });
    const hidden = await post("friend", "To hide");
    for (let i = 0; i < 44; i++) await post(i % 3 ? "friend" : "rude", `Post ${i}`);
    await post("stranger", "Not followed");
    await moderate(scope, "reader", { action: "block", ref: "rude" });
    await reportTarget(scope, "reader", { kind: "item", ref: `post:${hidden.id}` }, "Hide it");
    await moderate(scope, "owner", { action: "hide", id: (await moderationQueue(scope)).reports[0].id });
    const seen: string[] = []; let cursor: string | undefined;
    do { const page = await homeFeed(scope, "reader", cursor); seen.push(...page.posts.map(p => p.text)); cursor = page.nextCursor; } while (cursor);
    expect(seen).toHaveLength(29);
    expect(new Set(seen).size).toBe(29);
    expect(seen[0]).toBe("Post 43");
    expect(seen).not.toContain("To hide");
    expect(seen.some(text => ["Post 0", "Post 3"].includes(text))).toBe(false);
    expect((await homeFeed(scope, "rude")).posts.every(p => p.author.ref === "rude")).toBe(true);
    await expect(personFeed(scope, "rude", "reader")).rejects.toMatchObject({ status: 404 });
  });
  it("counts likes once under concurrency, names only public names, and cascades a delete", async () => {
    await saveProfile(scope, "named", { revision: 0, name: "Public Name", bio: "", links: [], public: { name: true, bio: false, links: false, photo: false } });
    await saveProfile(scope, "quiet", { revision: 0, name: "Private Name", bio: "", links: [], public: { name: false, bio: false, links: false, photo: false } });
    const created = await post("named", "Likeable");
    await Promise.all(Array.from({ length: 10 }, (_, i) => feedAction(scope, `liker-${i % 3}`, { action: "like", id: created.id })));
    expect(await feedAction(scope, "liker-0", { action: "like", id: created.id })).toMatchObject({ likes: 3, liked: true, author: { name: "Public Name" } });
    expect((await post("quiet")).author).toEqual({ ref: "quiet" });
    await feedAction(scope, "quiet", { action: "comment", id: created.id, text: "Nice" });
    await feedAction(scope, "named", { action: "delete", id: created.id });
    expect((await db`select count(*)::int as n from crm_post_like where post_id = ${created.id}`)[0].n).toBe(0);
    expect((await db`select count(*)::int as n from crm_comment where post_id = ${created.id}`)[0].n).toBe(0);
    await expect(postComments(scope, "named", created.id)).rejects.toMatchObject({ status: 404 });
  });
  it("lets one of two concurrent edits win and leaves other people's posts alone", async () => {
    const created = await post("editor", "Start");
    const edits = await Promise.allSettled(["One", "Two"].map(text => feedAction(scope, "editor", { action: "edit", id: created.id, revision: 0, text })));
    expect(edits.filter(e => e.status === "fulfilled")).toHaveLength(1);
    await expect(feedAction(scope, "other", { action: "delete", id: created.id })).rejects.toMatchObject({ status: 404 });
    expect((await db`select revision from crm_post where id = ${created.id}`)[0].revision).toBe(1);
  });
  it("lets one post claim a photo, even when two try at once", async () => {
    const finish = vi.spyOn(files, "finishUpload");
    const start = vi.spyOn(files, "startUpload");
    try {
      const fileId = `file_${randomUUID()}`;
      start.mockResolvedValueOnce({ fileId, uploadUrl: "https://files.test/up", headers: {} });
      finish.mockResolvedValueOnce({ fileId, kind: "image", contentType: "image/png", sizeBytes: 10, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), url: "https://files.test/a.png" });
      await feedAction(scope, "photographer", { action: "photo-start", contentType: "image/png", sizeBytes: 10 });
      await expect(feedAction(scope, "thief", { action: "photo-finish", fileId })).rejects.toMatchObject({ status: 403 });
      await feedAction(scope, "photographer", { action: "photo-finish", fileId });
      await expect(post("thief", "Mine now", { photos: [fileId] })).rejects.toMatchObject({ status: 403 });
      const claims = await Promise.allSettled([post("photographer", "One", { photos: [fileId] }), post("photographer", "Two", { photos: [fileId] })]);
      const won = claims.filter(c => c.status === "fulfilled") as PromiseFulfilledResult<FeedPost>[];
      expect(won).toHaveLength(1);
      expect(won[0].value.photos).toEqual([{ url: "https://files.test/a.png" }]);
      expect((await db`select count(*)::int as n from crm_post where scope = ${scope} and author = 'photographer'`)[0].n).toBe(1);
    } finally { finish.mockRestore(); start.mockRestore(); }
  });
  it("keeps people whose ids sort differently under the database's collation in one conversation", async () => {
    const first = await open("Zed", "amy");
    expect(await open("amy", "Zed")).toBe(first);
  });
  it("lands two people starting at once on one conversation and keeps every concurrent message", async () => {
    const [one, two] = await Promise.all([open("talker", "listener"), open("listener", "talker")]);
    expect(one).toBe(two);
    await Promise.all(Array.from({ length: 20 }, (_, i) => messagingAction(scope, "talker", { action: "send", id: one, text: `Message ${i}` })));
    await flushAfter();
    expect((await thread(scope, "listener", one)).messages).toHaveLength(20);
    expect((await conversationList(scope, "listener")).conversations[0]).toMatchObject({ unread: 20, person: { ref: "talker" } });
    await messagingAction(scope, "listener", { action: "read", id: one });
    expect((await conversationList(scope, "listener")).conversations[0].unread).toBe(0);
    expect((await thread(scope, "talker", one)).messages.every(m => m.read)).toBe(true);
  });
  it("keeps a conversation private, refuses across a block and hides a reported message", async () => {
    const id = await open("writer", "reader-two");
    await messagingAction(scope, "writer", { action: "send", id, text: "Fine" });
    const { id: awful } = await messagingAction(scope, "reader-two", { action: "send", id, text: "Awful" }) as { id: string };
    await expect(thread(scope, "stranger", id)).rejects.toMatchObject({ status: 404 });
    await messagingAction(scope, "writer", { action: "report", id, message: awful, reason: "Abuse" });
    const report = (await moderationQueue(scope)).reports.find(r => r.subject?.excerpt === "Awful")!;
    expect(report.subject?.label).toBe("Private message");
    await moderate(scope, "owner", { action: "hide", id: report.id });
    expect((await thread(scope, "writer", id)).messages.map(m => m.text)).toEqual(["Fine"]);
    expect((await conversationList(scope, "writer")).conversations.find(c => c.id === id)).toMatchObject({ preview: "Fine", unread: 0 });
    await moderate(scope, "reader-two", { action: "block", ref: "writer" });
    expect(await isBlocked("reader-two", "writer", scope)).toBe(true);
    await expect(messagingAction(scope, "writer", { action: "send", id, text: "Again" })).rejects.toMatchObject({ status: 404 });
    expect((await conversationList(scope, "writer")).conversations.find(c => c.id === id)).toBeUndefined();
  });
  it("keeps one open automatic report per post and updates its words", async () => {
    const target = { kind: "item" as const, ref: `post:${randomUUID()}` };
    await reportTarget(scope, "automatic", target, "Check", true, { label: "Community post", excerpt: "First" });
    await reportTarget(scope, "automatic", target, "Check", true, { label: "Community post", excerpt: "Second" });
    const rows = await db`select subject from crm_report where scope = ${scope} and ref = ${target.ref}`;
    expect(rows.map(r => r.subject.excerpt)).toEqual(["Second"]);
  });
  it("keeps data apart between communities", async () => {
    const other = `${scope}-other`;
    const created = await post("resident", "Here only");
    await expect(postComments(other, "resident", created.id)).rejects.toMatchObject({ status: 404 });
    expect((await homeFeed(other, "resident")).posts).toEqual([]);
  });
});
