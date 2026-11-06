import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeRows, resetCrmFake } from "@/lib/pramaan/crm-data";
import { resetFake } from "@/lib/pramaan/fake";
import { feedAction, homeFeed, personFeed, postComments, type FeedPost } from "@/lib/pramaan/feed";
import { conversationList, messagingAction, noticeNewMessage, sendThroughEmailModule, thread } from "@/lib/pramaan/messaging";
import { isHidden, moderate, moderationQueue } from "@/lib/pramaan/moderation";
import { saveProfile } from "@/lib/pramaan/profiles";
import { clearAfter, flushAfter } from "./next-server";
import * as context from "@/lib/pramaan/social-context";
import * as server from "@/lib/pramaan/server";
import * as files from "@/lib/pramaan/upload";
import { GET as feedGet, POST as feedPost } from "@/registry/feed/app/api/pramaan/feed/route";
import { GET as messagesGet, POST as messagesPost } from "@/registry/messaging/app/api/pramaan/messages/route";

const scope = "demo";
const post = (member: string, text = "Hello", extra = {}) => feedAction(scope, member, { action: "post", text, ...extra }) as Promise<FeedPost>;
const follow = (member: string, person: string) => feedAction(scope, member, { action: "follow", person });
const block = (member: string, person: string) => moderate(scope, member, { action: "block", ref: person });
const req = (url: string, body?: unknown, member = "alice", origin?: string) => new Request(`http://app.test${url}`, { method: body ? "POST" : "GET", headers: { cookie: `pramaan_member=${member}`, ...(body ? { "Content-Type": "application/json" } : {}), ...(origin ? { origin } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
const open = async (member: string, person: string) => (await messagingAction(scope, member, { action: "start", person }) as { id: string }).id;
const say = (member: string, id: string, text = "Hi") => messagingAction(scope, member, { action: "send", id, text }) as Promise<{ id: string }>;
const reports = () => moderationQueue(scope, "mbr_owner").then(q => q.reports);
beforeEach(() => { resetCrmFake(); resetFake(); clearAfter(); vi.stubEnv("PRAMAAN_SOCIAL_SCOPE", "demo"); vi.stubEnv("PRAMAAN_TEXT_SCREENING", ""); vi.stubEnv("PRAMAAN_MESSAGE_EMAIL", ""); });

describe("feed", () => {
  it("shows your own posts and the people you follow, newest first, and stops on unfollow", async () => {
    await post("carol", "Not followed"); await post("bob", "Older"); await post("alice", "Mine"); await post("bob", "Newer");
    await follow("alice", "bob");
    expect((await homeFeed(scope, "alice")).posts.map(p => p.text)).toEqual(["Newer", "Mine", "Older"]);
    await feedAction(scope, "alice", { action: "unfollow", person: "bob" });
    expect((await homeFeed(scope, "alice")).posts.map(p => p.text)).toEqual(["Mine"]);
  });
  it("pages with a cursor, without repeats or gaps, even when filtered posts sit at a page edge", async () => {
    await follow("alice", "bob"); await follow("alice", "mallory");
    for (let i = 0; i < 45; i++) await post(i % 3 ? "bob" : "mallory", `Post ${i}`);
    await block("alice", "mallory");
    const seen: string[] = []; let cursor: string | undefined;
    do { const page = await homeFeed(scope, "alice", cursor); seen.push(...page.posts.map(p => p.text)); cursor = page.nextCursor; } while (cursor);
    expect(seen).toHaveLength(30);
    expect(new Set(seen).size).toBe(30);
    expect(seen[0]).toBe("Post 44");
  });
  it("refuses a made-up cursor", async () => {
    await expect(homeFeed(scope, "alice", "1; drop table")).rejects.toMatchObject({ status: 400 });
  });
  it("lists a person's posts with follow state, and names only a public display name", async () => {
    await saveProfile(scope, "bob", { revision: 0, name: "Bobby", bio: "", links: [], public: { name: true, bio: false, links: false, photo: false } });
    await saveProfile(scope, "carol", { revision: 0, name: "Private Carol", bio: "", links: [], public: { name: false, bio: false, links: false, photo: false } });
    await post("bob"); await post("carol"); await follow("alice", "bob");
    expect(await personFeed(scope, "alice", "bob")).toMatchObject({ self: false, following: true, posts: [{ author: { ref: "bob", name: "Bobby" } }] });
    const { posts } = await personFeed(scope, "alice", "carol");
    expect(posts[0].author).toEqual({ ref: "carol" });
    expect((await personFeed(scope, "bob", "bob")).self).toBe(true);
  });
  it("hides blocked people both ways, everywhere, and refuses contact across a block", async () => {
    await follow("alice", "bob"); await follow("bob", "alice");
    const bob = await post("bob"); const alice = await post("alice");
    await feedAction(scope, "carol", { action: "comment", id: alice.id, text: "From carol" });
    await feedAction(scope, "bob", { action: "comment", id: alice.id, text: "From bob" });
    await block("alice", "bob");
    expect((await homeFeed(scope, "alice")).posts.map(p => p.id)).toEqual([alice.id]);
    expect((await homeFeed(scope, "bob")).posts.map(p => p.id)).toEqual([bob.id]);
    expect((await homeFeed(scope, "alice")).posts[0].comments).toBe(1);
    expect((await postComments(scope, "alice", alice.id)).comments.map(c => c.text)).toEqual(["From carol"]);
    await expect(personFeed(scope, "bob", "alice")).rejects.toMatchObject({ status: 404 });
    await expect(personFeed(scope, "alice", "bob")).rejects.toMatchObject({ status: 404 });
    for (const body of [{ action: "like", id: alice.id }, { action: "comment", id: alice.id, text: "x" }, { action: "report", target: "post", id: alice.id, reason: "x" }]) await expect(feedAction(scope, "bob", body)).rejects.toMatchObject({ status: 404 });
    await expect(follow("bob", "alice")).rejects.toMatchObject({ status: 404 });
  });
  it("reports a post for review with what it said, and a hidden post never shows", async () => {
    const bob = await post("bob", "Buy my thing"); await follow("alice", "bob");
    await feedAction(scope, "alice", { action: "report", target: "post", id: bob.id, reason: "Spam" });
    const [report] = await reports();
    expect(report.subject).toMatchObject({ label: "Community post", excerpt: "Buy my thing" });
    expect(await isHidden(`post:${bob.id}`, scope)).toBe(false);
    await moderate(scope, "mbr_owner", { action: "hide", id: report.id });
    expect((await homeFeed(scope, "alice")).posts).toEqual([]);
    expect((await personFeed(scope, "carol", "bob")).posts).toEqual([]);
    await expect(feedAction(scope, "alice", { action: "like", id: bob.id })).rejects.toMatchObject({ status: 404 });
  });
  it("keeps the reported words for reviewers after the post is edited or deleted", async () => {
    const bob = await post("bob", "Rude words");
    await feedAction(scope, "alice", { action: "report", target: "post", id: bob.id, reason: "Rude" });
    await feedAction(scope, "bob", { action: "delete", id: bob.id });
    expect((await reports())[0].subject?.excerpt).toBe("Rude words");
  });
  it("hides a reported comment without hiding its post", async () => {
    const bob = await post("bob");
    const { id } = await feedAction(scope, "carol", { action: "comment", id: bob.id, text: "Nasty" }) as { id: string };
    await feedAction(scope, "bob", { action: "report", target: "comment", id, reason: "Nasty" });
    await moderate(scope, "mbr_owner", { action: "hide", id: (await reports())[0].id });
    expect((await postComments(scope, "bob", bob.id)).comments).toEqual([]);
    expect((await personFeed(scope, "bob", "bob")).posts[0].comments).toBe(0);
  });
  it("lets only the author edit or delete, and refuses a stale edit", async () => {
    const bob = await post("bob", "First");
    await expect(feedAction(scope, "alice", { action: "edit", id: bob.id, revision: 0, text: "Hacked" })).rejects.toMatchObject({ status: 404 });
    await expect(feedAction(scope, "alice", { action: "delete", id: bob.id })).rejects.toMatchObject({ status: 404 });
    const edited = await feedAction(scope, "bob", { action: "edit", id: bob.id, revision: 0, text: "Second" }) as FeedPost;
    expect(edited).toMatchObject({ text: "Second", revision: 1, editedAt: expect.any(String) });
    await expect(feedAction(scope, "bob", { action: "edit", id: bob.id, revision: 0, text: "Stale" })).rejects.toMatchObject({ status: 409 });
    await feedAction(scope, "bob", { action: "delete", id: bob.id });
    expect((await personFeed(scope, "bob", "bob")).posts).toEqual([]);
  });
  it("refuses an edit to a hidden post without changing it, and a stale edit costs no text check", async () => {
    const bob = await post("bob", "Before");
    await feedAction(scope, "alice", { action: "report", target: "post", id: bob.id, reason: "Spam" });
    await moderate(scope, "mbr_owner", { action: "hide", id: (await reports())[0].id });
    await expect(feedAction(scope, "bob", { action: "edit", id: bob.id, revision: 0, text: "After" })).rejects.toMatchObject({ status: 404 });
    expect(fakeRows<{ id: string; body: string }>("crm_post").find(p => p.id === bob.id)?.body).toBe("Before");
    const fresh = await post("bob", "Fresh");
    await feedAction(scope, "bob", { action: "edit", id: fresh.id, revision: 0, text: "Newer" });
    vi.stubEnv("PRAMAAN_TEXT_SCREENING", "1");
    const check = vi.spyOn(server, "capability");
    await expect(feedAction(scope, "bob", { action: "edit", id: fresh.id, revision: 0, text: "Stale" })).rejects.toMatchObject({ status: 409 });
    expect(check).not.toHaveBeenCalled();
    check.mockRestore();
  });
  it("lets only a comment's author edit or delete it", async () => {
    const bob = await post("bob");
    const { id } = await feedAction(scope, "carol", { action: "comment", id: bob.id, text: "One" }) as { id: string };
    await expect(feedAction(scope, "bob", { action: "delete-comment", id })).rejects.toMatchObject({ status: 404 });
    await expect(feedAction(scope, "bob", { action: "edit-comment", id, text: "Hacked" })).rejects.toMatchObject({ status: 404 });
    await feedAction(scope, "carol", { action: "edit-comment", id, text: "Two" });
    expect((await postComments(scope, "bob", bob.id)).comments[0]).toMatchObject({ text: "Two", editedAt: expect.any(String) });
    await feedAction(scope, "carol", { action: "delete-comment", id });
    expect((await postComments(scope, "bob", bob.id)).comments).toEqual([]);
  });
  it("counts one like per person and removes it again", async () => {
    const bob = await post("bob");
    await feedAction(scope, "alice", { action: "like", id: bob.id });
    expect(await feedAction(scope, "alice", { action: "like", id: bob.id })).toMatchObject({ likes: 1, liked: true });
    expect(await feedAction(scope, "alice", { action: "unlike", id: bob.id })).toMatchObject({ likes: 0, liked: false });
  });
  it("checks new text only when screening is on, and never hides it", async () => {
    const check = vi.spyOn(server, "capability").mockResolvedValue({ primaryCategory: "spam", confidence: 0.95 });
    try {
      await post("bob", "Quiet"); expect(check).not.toHaveBeenCalled();
      vi.stubEnv("PRAMAAN_TEXT_SCREENING", "1");
      const flagged = await post("bob", "Flagged words");
      expect(check).toHaveBeenCalledWith("text.classify", { text: "Flagged words" });
      expect((await reports())[0]).toMatchObject({ automatic: true, subject: { excerpt: "Flagged words" } });
      expect((await personFeed(scope, "bob", "bob")).posts.map(p => p.id)).toContain(flagged.id);
    } finally { check.mockRestore(); }
  });
  it("shows reviewers the newest words when the check runs again on an edit, and keeps a person's report as made", async () => {
    const check = vi.spyOn(server, "capability").mockResolvedValue({ primaryCategory: "spam", confidence: 0.95 });
    try {
      const bob = await post("bob", "Fine words");
      await feedAction(scope, "alice", { action: "report", target: "post", id: bob.id, reason: "Rude" });
      vi.stubEnv("PRAMAAN_TEXT_SCREENING", "1");
      await feedAction(scope, "bob", { action: "edit", id: bob.id, revision: 0, text: "First edit" });
      await feedAction(scope, "bob", { action: "edit", id: bob.id, revision: 1, text: "Second edit" });
      const queue = await reports();
      expect(queue).toHaveLength(2);
      expect(queue.find(r => r.automatic)?.subject?.excerpt).toBe("Second edit");
      expect(queue.find(r => !r.automatic)?.subject?.excerpt).toBe("Fine words");
    } finally { check.mockRestore(); }
  });
  describe("photos", () => {
    const stored = (fileId: string, extra = {}) => ({ fileId, kind: "image" as const, contentType: "image/png", sizeBytes: 10, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), url: `https://files.test/${fileId}`, ...extra });
    const start = (member: string) => feedAction(scope, member, { action: "photo-start", contentType: "image/png", sizeBytes: 10 }) as Promise<{ fileId: string }>;
    const ready = async (member: string, extra = {}) => {
      const { fileId } = await start(member);
      const finish = vi.spyOn(files, "finishUpload").mockResolvedValueOnce(stored(fileId, extra));
      await feedAction(scope, member, { action: "photo-finish", fileId });
      finish.mockRestore();
      return fileId;
    };
    it("attaches the person's own finished photos and shows no storage reference", async () => {
      const fileId = await ready("bob");
      const created = await post("bob", "With a photo", { photos: [fileId] });
      expect(created.photos).toEqual([{ url: `https://files.test/${fileId}` }]);
      expect(JSON.stringify(created)).not.toContain(`"${fileId}"`);
    });
    it("refuses another person's photo, an unfinished photo and using one twice", async () => {
      const theirs = await ready("bob");
      await expect(feedAction(scope, "alice", { action: "photo-finish", fileId: theirs })).rejects.toMatchObject({ status: 403 });
      await expect(post("alice", "Stolen", { photos: [theirs] })).rejects.toMatchObject({ status: 403 });
      const { fileId } = await start("alice");
      await expect(post("alice", "Unfinished", { photos: [fileId] })).rejects.toMatchObject({ status: 403 });
      await post("bob", "First", { photos: [theirs] });
      await expect(post("bob", "Second", { photos: [theirs] })).rejects.toMatchObject({ status: 403 });
    });
    it.each([["image/svg+xml", 10], ["text/html", 10], ["image/png", 5_000_001]])("refuses %s of %d bytes before upload", async (contentType, sizeBytes) => {
      await expect(feedAction(scope, "bob", { action: "photo-start", contentType, sizeBytes })).rejects.toThrow("PNG, JPEG or WebP");
    });
    it("checks the file that really arrived and removes a refused one", async () => {
      const remove = vi.spyOn(files, "deleteUpload").mockResolvedValue({ deleted: true });
      const { fileId } = await start("bob");
      const finish = vi.spyOn(files, "finishUpload").mockResolvedValueOnce(stored(fileId, { sizeBytes: 6_000_000 }));
      await expect(feedAction(scope, "bob", { action: "photo-finish", fileId })).rejects.toThrow("under 5 MB");
      expect(remove).toHaveBeenCalledWith(fileId);
      remove.mockRestore(); finish.mockRestore();
    });
    it("caps a post at four photos, leaves out expired links and deletes files with the post", async () => {
      await expect(post("bob", "Too many", { photos: ["a", "b", "c", "d", "e"] })).rejects.toThrow("up to 4");
      const old = await ready("bob", { expiresAt: new Date(Date.now() - 1000).toISOString() });
      const created = await post("bob", "Old photo", { photos: [old] });
      expect(created.photos).toEqual([]);
      const remove = vi.spyOn(files, "deleteUpload").mockResolvedValue({ deleted: true });
      await feedAction(scope, "bob", { action: "delete", id: created.id });
      expect(remove).toHaveBeenCalledWith(old);
      remove.mockRestore();
    });
  });
  describe("route", () => {
    it("requires sign-in for every read and write, and refuses foreign origins", async () => {
      expect((await feedGet(req("/api/pramaan/feed", undefined, "none"))).status).toBe(401);
      expect((await feedGet(req("/api/pramaan/feed?person=bob", undefined, "none"))).status).toBe(401);
      expect((await feedPost(req("/api/pramaan/feed", { action: "post", text: "x" }, "none"))).status).toBe(401);
      expect((await feedPost(req("/api/pramaan/feed", { action: "post", text: "x" }, "alice", "https://other.test"))).status).toBe(403);
    });
    it("writes as the signed-in person, whatever the body claims", async () => {
      await feedPost(req("/api/pramaan/feed", { action: "post", text: "x", author: "victim", member: "victim" }));
      expect((await personFeed(scope, "carol", "victim")).posts).toEqual([]);
    });
    it("limits writes per person, not per address alone", async () => {
      const write = (member: string) => { const request = req("/api/pramaan/feed", { action: "post", text: "x" }, member); request.headers.set("x-forwarded-for", "203.0.113.9"); return feedPost(request); };
      let last: Response | undefined;
      for (let i = 0; i < 61; i++) last = await write("alice");
      expect(last!.status).toBe(429);
      expect((await write("bob")).status).toBe(200);
    });
    it("needs the configured bot check on writes", async () => {
      vi.stubEnv("PRAMAAN_BOT_CHECK_SECRET", "enabled");
      expect((await feedPost(req("/api/pramaan/feed", { action: "post", text: "x" }))).status).toBe(400);
    });
    it("answers plainly, with no database or capability wording", async () => {
      const response = await feedPost(req("/api/pramaan/feed", { action: "nonsense" }));
      expect((await response.json()).error.message).toBe("Choose an action to continue.");
    });
  });
});

describe("messaging", () => {
  it("keeps one conversation per pair, whoever starts it", async () => {
    const first = await open("alice", "bob");
    expect(await open("bob", "alice")).toBe(first);
    await expect(open("alice", "alice")).rejects.toThrow("another person");
  });
  it("shows a conversation to the other person only after a message", async () => {
    const id = await open("alice", "bob");
    expect((await conversationList(scope, "alice")).conversations).toHaveLength(1);
    expect((await conversationList(scope, "bob")).conversations).toHaveLength(0);
    await say("alice", id);
    expect((await conversationList(scope, "bob")).conversations).toHaveLength(1);
  });
  it("counts unread for the reader only, and read state reaches the sender", async () => {
    const id = await open("alice", "bob");
    await say("alice", id, "One"); await say("alice", id, "Two");
    expect((await conversationList(scope, "bob")).conversations[0]).toMatchObject({ unread: 2, preview: "Two" });
    expect((await conversationList(scope, "alice")).conversations[0].unread).toBe(0);
    expect((await thread(scope, "alice", id)).messages.map(m => m.read)).toEqual([false, false]);
    await messagingAction(scope, "bob", { action: "read", id });
    expect((await conversationList(scope, "bob")).conversations[0].unread).toBe(0);
    expect((await thread(scope, "alice", id)).messages.map(m => m.read)).toEqual([true, true]);
    await say("alice", id, "Three");
    expect((await conversationList(scope, "bob")).conversations[0].unread).toBe(1);
  });
  it("pages back through older messages without repeats", async () => {
    const id = await open("alice", "bob");
    for (let i = 0; i < 55; i++) await say("alice", id, `Message ${i}`);
    const latest = await thread(scope, "bob", id);
    expect(latest.messages).toHaveLength(50);
    expect(latest.messages.at(-1)?.text).toBe("Message 54");
    const older = await thread(scope, "bob", id, latest.earlier);
    expect(older.messages.map(m => m.text)).toEqual([0, 1, 2, 3, 4].map(i => `Message ${i}`));
    expect(older.earlier).toBeUndefined();
  });
  it("keeps a conversation from everyone but its two people", async () => {
    const id = await open("alice", "bob");
    const { id: message } = await say("alice", id);
    await expect(thread(scope, "mallory", id)).rejects.toMatchObject({ status: 404 });
    await expect(say("mallory", id, "Let me in")).rejects.toMatchObject({ status: 404 });
    await expect(messagingAction(scope, "mallory", { action: "read", id })).rejects.toMatchObject({ status: 404 });
    await expect(messagingAction(scope, "mallory", { action: "report", id, message, reason: "x" })).rejects.toMatchObject({ status: 404 });
    expect((await conversationList(scope, "mallory")).conversations).toEqual([]);
  });
  it("stops blocked people messaging each other in both directions and restores it on unblock", async () => {
    const id = await open("alice", "bob"); await say("alice", id);
    await block("bob", "alice");
    await expect(say("alice", id)).rejects.toMatchObject({ status: 404 });
    await expect(say("bob", id)).rejects.toMatchObject({ status: 404 });
    await expect(thread(scope, "alice", id)).rejects.toMatchObject({ status: 404 });
    await expect(open("alice", "bob")).rejects.toMatchObject({ status: 404 });
    await expect(open("bob", "alice")).rejects.toMatchObject({ status: 404 });
    expect((await conversationList(scope, "alice")).conversations).toEqual([]);
    expect((await conversationList(scope, "bob")).conversations).toEqual([]);
    await moderate(scope, "bob", { action: "unblock", ref: "alice" });
    await say("alice", id, "Back");
    expect((await conversationList(scope, "bob")).conversations).toHaveLength(1);
  });
  it("reports only the other person's message, shows reviewers just that message, and a hidden message never shows", async () => {
    const id = await open("alice", "bob");
    const { id: mine } = await say("alice", id, "Fine"); const { id: theirs } = await say("bob", id, "Awful");
    await expect(messagingAction(scope, "alice", { action: "report", id, message: mine, reason: "x" })).rejects.toMatchObject({ status: 404 });
    await messagingAction(scope, "alice", { action: "report", id, message: theirs, reason: "Abuse" });
    const [report] = await reports();
    expect(report.subject).toMatchObject({ label: "Private message", excerpt: "Awful" });
    expect(JSON.stringify(report)).not.toContain("Fine");
    await moderate(scope, "mbr_owner", { action: "hide", id: report.id });
    expect((await thread(scope, "alice", id)).messages.map(m => m.text)).toEqual(["Fine"]);
    expect((await conversationList(scope, "alice")).conversations[0]).toMatchObject({ preview: "Fine", unread: 0 });
  });
  it("caps a message at 4,000 characters and refuses an empty one", async () => {
    const id = await open("alice", "bob");
    await expect(say("alice", id, "x".repeat(4001))).rejects.toThrow("up to 4000");
    await expect(say("alice", id, "   ")).rejects.toThrow("Enter a message");
  });
  it("shows only a public name for the other person", async () => {
    await saveProfile(scope, "bob", { revision: 0, name: "Private Bob", bio: "", links: [], public: { name: false, bio: false, links: false, photo: false } });
    const id = await open("alice", "bob");
    expect((await thread(scope, "alice", id)).person).toEqual({ ref: "bob" });
  });
  it("sends no notice unless switched on, then one for a run of unread messages, with no message words", async () => {
    const notices = () => fakeRows<{ to: string; key: string }>("crm_message_notice");
    const id = await open("alice", "bob");
    await say("alice", id, "Quiet"); await flushAfter();
    expect(notices()).toEqual([]);
    await messagingAction(scope, "bob", { action: "read", id });
    vi.stubEnv("PRAMAAN_MESSAGE_EMAIL", "1");
    await say("alice", id, "One"); await say("alice", id, "Two"); await flushAfter();
    expect(notices()).toHaveLength(1);
    expect(notices()[0].to).toBe("bob@example.com");
    await messagingAction(scope, "bob", { action: "read", id });
    await say("alice", id, "Three"); await flushAfter();
    expect(notices()).toHaveLength(2);
    expect(notices()[0].key).not.toBe(notices()[1].key);
  });
  it("never fails a send because the notice failed, and sends nothing without an address", async () => {
    vi.stubEnv("PRAMAAN_MESSAGE_EMAIL", "1"); vi.stubEnv("PRAMAAN_FAKE", "0"); vi.stubEnv("PRAMAAN_MODULES_DIR", "/nonexistent/modules");
    const email = vi.spyOn(context, "memberEmail").mockResolvedValueOnce("bob@example.com");
    try {
      await expect(noticeNewMessage(scope, "bob", "key")).resolves.toBeUndefined();
      expect(email).toHaveBeenCalledOnce();
      email.mockRejectedValueOnce(new Error("lookup failed"));
      await expect(noticeNewMessage(scope, "bob", "key")).resolves.toBeUndefined();
    } finally { email.mockRestore(); vi.stubEnv("PRAMAAN_FAKE", "1"); }
  });
  it("sends through the email module with the key, the token and fixed words", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "b3-"));
    await writeFile(path.join(directory, "token"), "secret\n");
    const seen: { headers: Record<string, unknown>; body: string }[] = [];
    const module = createServer((request, response) => {
      let body = ""; request.on("data", chunk => body += chunk);
      request.on("end", () => { seen.push({ headers: request.headers, body }); response.end("{}"); });
    });
    await new Promise<void>(resolve => module.listen(path.join(directory, "modules.sock"), resolve));
    try {
      await sendThroughEmailModule({ to: "bob@example.com", subject: "Fixed", text: "Fixed" }, "message:one", directory);
      expect(seen[0].headers).toMatchObject({ authorization: "Bearer secret", "idempotency-key": "message:one" });
      expect(JSON.parse(seen[0].body)).toEqual({ to: "bob@example.com", subject: "Fixed", text: "Fixed" });
    } finally { module.close(); await rm(directory, { recursive: true, force: true }); }
  });
  describe("route", () => {
    it("requires sign-in, refuses foreign origins, and answers polling within the limit", async () => {
      expect((await messagesGet(req("/api/pramaan/messages", undefined, "none"))).status).toBe(401);
      expect((await messagesPost(req("/api/pramaan/messages", { action: "start", person: "bob" }, "alice", "https://other.test"))).status).toBe(403);
      for (let i = 0; i < 40; i++) expect((await messagesGet(req("/api/pramaan/messages"))).status).toBe(200);
    });
    it("sends as the signed-in person, whatever the body claims", async () => {
      const id = await open("alice", "bob");
      await messagesPost(req("/api/pramaan/messages", { action: "send", id, text: "Hi", sender: "bob" }));
      expect((await thread(scope, "bob", id)).messages[0].mine).toBe(false);
    });
    it("gives a stranger the same answer as a missing conversation", async () => {
      const id = await open("bob", "carol");
      const stranger = await messagesGet(req(`/api/pramaan/messages?conversation=${id}`));
      const missing = await messagesGet(req("/api/pramaan/messages?conversation=00000000-0000-4000-8000-000000000000"));
      expect(stranger.status).toBe(404);
      expect(await stranger.json()).toEqual(await missing.json());
    });
  });
});
