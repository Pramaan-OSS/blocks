import "server-only";
import { randomUUID } from "node:crypto";
import { crmDatabase, fakeRows, text, CrmProblem } from "@/lib/pramaan/crm-data";
import { blockedEitherWay, canSee, checkNewText, moderate, reportTarget, visibleSql, type Subject } from "@/lib/pramaan/moderation";
import { PHOTO_TYPES } from "@/lib/pramaan/profiles";
import { deleteUpload, finishUpload, startUpload, type StoredFile } from "@/lib/pramaan/upload";

/** `name` is only ever the person's public display name. `ref` links to them and is never shown. */
export type Author = { ref: string; name?: string };
export type FeedPost = { id: string; seq: string; revision: number; mine: boolean; author: Author; text: string; photos: { url: string }[]; at: string; editedAt?: string; likes: number; liked: boolean; comments: number };
export type FeedComment = { id: string; mine: boolean; author: Author; text: string; at: string; editedAt?: string };
export type FeedPage = { posts: FeedPost[]; nextCursor?: string };
export type PersonPage = FeedPage & { self: boolean; following: boolean };
type PostRow = { id: string; seq: number; scope: string; author: string; body: string; photos: StoredFile[]; revision: number; at: string; editedAt?: string };
type CommentRow = { id: string; seq: number; scope: string; postId: string; author: string; body: string; at: string; editedAt?: string };
type Upload = { scope: string; fileId: string; person: string; file?: StoredFile };

const PAGE = 20;
const COMMENTS_SHOWN = 50;
const MAX_PHOTOS = 4;
const MAX_PHOTO_BYTES = 5_000_000;
const isFake = () => process.env.PRAMAAN_FAKE === "1";
const iso = (value: Date | string | null | undefined) => value ? new Date(value).toISOString() : undefined;
const postRef = (id: string) => `post:${id}`;
const commentRef = (id: string) => `comment:${id}`;
const gone = (what = "post") => new CrmProblem(`This ${what} is no longer available.`, 404);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idOf = (value: unknown, what = "post") => {
  if (typeof value !== "string" || !UUID.test(value)) throw gone(what);
  return value.toLowerCase();
};
const subjectOf = (label: string, author: string, body: string): Subject => ({ label, href: `/profiles/${encodeURIComponent(author)}`, excerpt: body.slice(0, 280) });
const liveUrls = (photos: StoredFile[]) => photos.flatMap(p => p.url && Date.parse(p.expiresAt) > Date.now() ? [{ url: p.url }] : []);

const fakePosts = () => fakeRows<PostRow>("crm_post");
const fakeLikes = () => fakeRows<{ postId: string; person: string }>("crm_post_like");
const fakeComments = () => fakeRows<CommentRow>("crm_comment");
const fakeFollows = () => fakeRows<{ scope: string; follower: string; followed: string }>("crm_follow");
const fakeUploads = () => fakeRows<Upload>("crm_feed_upload");
function fakeSeq() { const seq = fakeRows<number>("crm_feed_seq"); seq.push(0); return seq.length; }
function fakeName(scope: string, person: string) {
  const profile = fakeRows<{ scope: string; person: string; name: string; public: { name: boolean } }>("crm_profile").find(p => p.scope === scope && p.person === person);
  return profile?.public.name && profile.name ? profile.name : undefined;
}
const fakeVisible = async <T extends { author: string; id: string }>(scope: string, viewer: string, rows: T[], ref: (id: string) => string, limit: number) => {
  const shown: T[] = [];
  for (const row of rows) {
    if (shown.length >= limit) break;
    if (await canSee(scope, viewer, row.author, ref(row.id))) shown.push(row);
  }
  return shown;
};

function author(ref: string, name: string | null | undefined): Author { return { ref, ...(name ? { name } : {}) }; }
async function fakePost(scope: string, viewer: string, post: PostRow): Promise<FeedPost> {
  const likes = fakeLikes().filter(l => l.postId === post.id);
  const comments = await fakeVisible(scope, viewer, fakeComments().filter(c => c.postId === post.id), commentRef, Infinity);
  return { id: post.id, seq: String(post.seq), revision: post.revision, mine: post.author === viewer, author: author(post.author, fakeName(scope, post.author)), text: post.body, photos: liveUrls(post.photos), at: post.at, ...(post.editedAt ? { editedAt: post.editedAt } : {}), likes: likes.length, liked: likes.some(l => l.person === viewer), comments: comments.length };
}
function postFrom(row: Record<string, any>, viewer: string): FeedPost {
  return { id: row.id, seq: String(row.seq), revision: row.revision, mine: row.author === viewer, author: author(row.author, row.author_name), text: row.body, photos: liveUrls(row.photos), at: iso(row.created_at)!, ...(row.edited_at ? { editedAt: iso(row.edited_at) } : {}), likes: row.likes, liked: row.liked, comments: row.comments };
}

type Which = { home: true } | { person: string } | { id: string };
/** One query per page: blocked people and hidden items are left out by the query, so paging never skips. */
async function loadPosts(scope: string, viewer: string, which: Which, limit: number, cursor?: string): Promise<FeedPost[]> {
  if (isFake()) {
    const followed = fakeFollows().filter(f => f.scope === scope && f.follower === viewer).map(f => f.followed);
    const rows = fakePosts().filter(p => p.scope === scope && (!cursor || p.seq < Number(cursor)) && ("id" in which ? p.id === which.id : "person" in which ? p.author === which.person : p.author === viewer || followed.includes(p.author))).sort((a, z) => z.seq - a.seq);
    return Promise.all((await fakeVisible(scope, viewer, rows, postRef, limit)).map(p => fakePost(scope, viewer, p)));
  }
  const sql = crmDatabase();
  const chosen = "id" in which ? sql`p.id = ${which.id}` : "person" in which ? sql`p.author = ${which.person}`
    : sql`(p.author = ${viewer} or p.author in (select followed from crm_follow f where f.scope = ${scope} and f.follower = ${viewer}))`;
  const rows = await sql`select p.*, case when n.public_name then nullif(n.name, '') end as author_name,
      (select count(*)::int from crm_post_like l where l.post_id = p.id) as likes,
      exists (select 1 from crm_post_like l where l.post_id = p.id and l.person = ${viewer}) as liked,
      (select count(*)::int from crm_comment c where c.post_id = p.id and ${visibleSql(scope, viewer, sql`c.author`, sql`${"comment:"} || c.id::text`)}) as comments
    from crm_post p left join crm_profile n on n.scope = p.scope and n.person = p.author
    where p.scope = ${scope} and ${chosen} and ${cursor ? sql`p.seq < ${cursor}::bigint` : sql`true`}
      and ${visibleSql(scope, viewer, sql`p.author`, sql`${"post:"} || p.id::text`)}
    order by p.seq desc limit ${limit}`;
  return rows.map(row => postFrom(row, viewer));
}
function validCursor(cursor: string | null | undefined) {
  if (!cursor) return undefined;
  if (!/^\d{1,18}$/.test(cursor)) throw new CrmProblem("Reload to see the latest posts.");
  return cursor;
}
async function page(scope: string, viewer: string, which: Which, cursor?: string | null): Promise<FeedPage> {
  const rows = await loadPosts(scope, viewer, which, PAGE + 1, validCursor(cursor));
  const posts = rows.slice(0, PAGE);
  return { posts, ...(rows.length > PAGE ? { nextCursor: posts[PAGE - 1].seq } : {}) };
}
/** Your own posts and those of the people you follow, newest first. */
export const homeFeed = (scope: string, viewer: string, cursor?: string | null) => page(scope, viewer, { home: true }, cursor);
async function isFollowing(scope: string, follower: string, followed: string) {
  if (isFake()) return fakeFollows().some(f => f.scope === scope && f.follower === follower && f.followed === followed);
  return (await crmDatabase()`select 1 from crm_follow where scope = ${scope} and follower = ${follower} and followed = ${followed}`).length > 0;
}
/** A person's own posts, for their profile page. */
export async function personFeed(scope: string, viewer: string, person: string, cursor?: string | null): Promise<PersonPage> {
  const ref = text(person, "a person", 200);
  if (await blockedEitherWay(viewer, ref, scope)) throw new CrmProblem("These posts aren't available.", 404);
  return { ...await page(scope, viewer, { person: ref }, cursor), self: ref === viewer, following: await isFollowing(scope, viewer, ref) };
}
async function findPost(scope: string, id: string): Promise<{ author: string; body: string; revision: number; photos: StoredFile[] } | undefined> {
  if (isFake()) return fakePosts().find(p => p.scope === scope && p.id === id);
  const [row] = await crmDatabase()`select author, body, revision, photos from crm_post where scope = ${scope} and id = ${id}`;
  return row as never;
}
async function visiblePost(scope: string, viewer: string, id: string) {
  const post = await findPost(scope, id);
  if (!post || !await canSee(scope, viewer, post.author, postRef(id))) throw gone();
  return post;
}
async function onePost(scope: string, viewer: string, id: string) {
  const [post] = await loadPosts(scope, viewer, { id }, 1);
  if (!post) throw gone();
  return post;
}
/** The newest comments on a post, oldest of those first. */
export async function postComments(scope: string, viewer: string, postId: string): Promise<{ comments: FeedComment[] }> {
  const id = idOf(postId);
  await visiblePost(scope, viewer, id);
  if (isFake()) {
    const rows = await fakeVisible(scope, viewer, fakeComments().filter(c => c.scope === scope && c.postId === id).sort((a, z) => z.seq - a.seq), commentRef, COMMENTS_SHOWN);
    return { comments: rows.reverse().map(c => ({ id: c.id, mine: c.author === viewer, author: author(c.author, fakeName(scope, c.author)), text: c.body, at: c.at, ...(c.editedAt ? { editedAt: c.editedAt } : {}) })) };
  }
  const sql = crmDatabase();
  // ponytail: the newest 50 only; add cursor paging when threads run longer than that.
  const rows = await sql`select c.*, case when n.public_name then nullif(n.name, '') end as author_name
    from crm_comment c left join crm_profile n on n.scope = c.scope and n.person = c.author
    where c.scope = ${scope} and c.post_id = ${id} and ${visibleSql(scope, viewer, sql`c.author`, sql`${"comment:"} || c.id::text`)}
    order by c.seq desc limit ${COMMENTS_SHOWN}`;
  return { comments: rows.reverse().map(c => ({ id: c.id, mine: c.author === viewer, author: author(c.author, c.author_name), text: c.body, at: iso(c.created_at)!, ...(c.edited_at ? { editedAt: iso(c.edited_at) } : {}) })) };
}

function photoIds(value: unknown) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_PHOTOS) throw new CrmProblem(`Add up to ${MAX_PHOTOS} photos.`);
  const ids = [...new Set(value)];
  if (ids.length !== value.length || ids.some(id => typeof id !== "string")) throw new CrmProblem("Add each photo once.");
  return ids as string[];
}
async function createPost(scope: string, member: string, body: Record<string, unknown>) {
  const content = text(body.text, "a post", 2000);
  const ids = photoIds(body.photos);
  const id = randomUUID();
  const missing = () => new CrmProblem("Add that photo again.", 403);
  // Queue before saving: if queue storage fails, no unreviewed new text is committed.
  await checkNewText(scope, { kind: "item", ref: postRef(id) }, content, subjectOf("Community post", member, content));
  if (isFake()) {
    const uploads = fakeUploads();
    const claimed = ids.map(fileId => uploads.find(u => u.scope === scope && u.person === member && u.fileId === fileId && u.file));
    if (claimed.some(u => !u)) throw missing();
    for (const upload of claimed) uploads.splice(uploads.indexOf(upload!), 1);
    fakePosts().push({ id, seq: fakeSeq(), scope, author: member, body: content, photos: claimed.map(u => u!.file!), revision: 0, at: new Date().toISOString() });
  } else {
    await crmDatabase().begin(async tx => {
      // Deleting the binding claims each upload once, for the person who started it, even under races.
      const claimed = ids.length ? await tx`delete from crm_feed_upload where scope = ${scope} and person = ${member} and file is not null and file_id in ${tx(ids)} returning file_id, file` : [];
      if (claimed.length !== ids.length) throw missing();
      const photos = ids.map(fileId => claimed.find(row => row.file_id === fileId)!.file);
      await tx`insert into crm_post (id, scope, author, body, photos) values (${id}, ${scope}, ${member}, ${content}, ${JSON.stringify(photos)}::text::jsonb)`;
    });
  }
  return onePost(scope, member, id);
}
async function ownPost(scope: string, member: string, id: string) {
  const post = await findPost(scope, id);
  if (post?.author !== member) throw gone();
  return post;
}
async function editPost(scope: string, member: string, body: Record<string, unknown>) {
  const id = idOf(body.id);
  const content = text(body.text, "a post", 2000);
  const expected = body.revision;
  // Checked first: a hidden post can't change, and a stale edit costs no text check.
  const post = await visiblePost(scope, member, id);
  if (post.author !== member) throw gone();
  const stale = () => new CrmProblem("This post changed. Reload to see the latest.", 409);
  if (post.revision !== expected) throw stale();
  await checkNewText(scope, { kind: "item", ref: postRef(id) }, content, subjectOf("Community post", member, content));
  if (isFake()) {
    Object.assign(fakePosts().find(p => p.scope === scope && p.id === id)!, { body: content, revision: post.revision + 1, editedAt: new Date().toISOString() });
  } else {
    // The revision condition makes one of two concurrent edits of the same version win.
    const [row] = await crmDatabase()`update crm_post set body = ${content}, revision = revision + 1, edited_at = now()
      where scope = ${scope} and id = ${id} and author = ${member} and revision = ${post.revision} returning id`;
    if (!row) throw stale();
  }
  return onePost(scope, member, id);
}
/** Best effort: an expired or already removed file is not an error. */
const discard = (fileId: string) => deleteUpload(fileId).catch(() => undefined);
async function deletePost(scope: string, member: string, body: Record<string, unknown>) {
  const id = idOf(body.id);
  const post = await ownPost(scope, member, id);
  if (isFake()) {
    fakePosts().splice(fakePosts().findIndex(p => p.id === id), 1);
    for (const rows of [fakeLikes(), fakeComments()] as { postId: string }[][]) {
      for (let i = rows.length - 1; i >= 0; i--) if (rows[i].postId === id) rows.splice(i, 1);
    }
  } else await crmDatabase()`delete from crm_post where scope = ${scope} and id = ${id} and author = ${member}`;
  await Promise.all(post.photos.map(photo => discard(photo.fileId)));
  return { deleted: true };
}
async function setLike(scope: string, member: string, body: Record<string, unknown>) {
  const id = idOf(body.id);
  await visiblePost(scope, member, id);
  const liked = body.action === "like";
  if (isFake()) {
    const likes = fakeLikes(); const at = likes.findIndex(l => l.postId === id && l.person === member);
    if (at >= 0) likes.splice(at, 1);
    if (liked) likes.push({ postId: id, person: member });
  } else if (liked) await crmDatabase()`insert into crm_post_like (post_id, person) values (${id}, ${member}) on conflict do nothing`;
  else await crmDatabase()`delete from crm_post_like where post_id = ${id} and person = ${member}`;
  return onePost(scope, member, id);
}
async function addComment(scope: string, member: string, body: Record<string, unknown>) {
  const postId = idOf(body.id);
  const content = text(body.text, "a comment", 1000);
  await visiblePost(scope, member, postId);
  const id = randomUUID();
  await checkNewText(scope, { kind: "item", ref: commentRef(id) }, content, subjectOf("Comment on a post", member, content));
  if (isFake()) fakeComments().push({ id, seq: fakeSeq(), scope, postId, author: member, body: content, at: new Date().toISOString() });
  else await crmDatabase()`insert into crm_comment (id, scope, post_id, author, body) values (${id}, ${scope}, ${postId}, ${member}, ${content})`;
  return { id };
}
async function findComment(scope: string, id: string): Promise<{ author: string; body: string; postId: string } | undefined> {
  if (isFake()) return fakeComments().find(c => c.scope === scope && c.id === id);
  const [row] = await crmDatabase()`select author, body, post_id from crm_comment where scope = ${scope} and id = ${id}`;
  return row && { author: row.author, body: row.body, postId: row.post_id };
}
async function editComment(scope: string, member: string, body: Record<string, unknown>) {
  const id = idOf(body.id, "comment");
  const content = text(body.text, "a comment", 1000);
  if ((await findComment(scope, id))?.author !== member) throw gone("comment");
  await checkNewText(scope, { kind: "item", ref: commentRef(id) }, content, subjectOf("Comment on a post", member, content));
  if (isFake()) Object.assign(fakeComments().find(c => c.id === id)!, { body: content, editedAt: new Date().toISOString() });
  // ponytail: last save wins; only the author can edit, so the most this loses is their own other tab.
  else await crmDatabase()`update crm_comment set body = ${content}, edited_at = now() where scope = ${scope} and id = ${id} and author = ${member}`;
  return { id };
}
async function deleteComment(scope: string, member: string, body: Record<string, unknown>) {
  const id = idOf(body.id, "comment");
  if ((await findComment(scope, id))?.author !== member) throw gone("comment");
  if (isFake()) fakeComments().splice(fakeComments().findIndex(c => c.id === id), 1);
  else await crmDatabase()`delete from crm_comment where scope = ${scope} and id = ${id} and author = ${member}`;
  return { deleted: true };
}
async function setFollow(scope: string, member: string, body: Record<string, unknown>) {
  const person = text(body.person, "a person", 200);
  if (person === member) throw new CrmProblem("Choose another person.");
  const following = body.action === "follow";
  if (following && await blockedEitherWay(member, person, scope)) throw new CrmProblem("This person isn't available.", 404);
  if (isFake()) {
    const follows = fakeFollows(); const at = follows.findIndex(f => f.scope === scope && f.follower === member && f.followed === person);
    if (at >= 0) follows.splice(at, 1);
    if (following) follows.push({ scope, follower: member, followed: person });
  } else if (following) await crmDatabase()`insert into crm_follow (scope, follower, followed) values (${scope}, ${member}, ${person}) on conflict do nothing`;
  else await crmDatabase()`delete from crm_follow where scope = ${scope} and follower = ${member} and followed = ${person}`;
  return { following };
}
async function reportContent(scope: string, member: string, body: Record<string, unknown>) {
  const why = text(body.reason, "a reason", 1000);
  if (body.target === "comment") {
    const id = idOf(body.id, "comment");
    const comment = await findComment(scope, id);
    if (!comment || !await canSee(scope, member, comment.author, commentRef(id))) throw gone("comment");
    await reportTarget(scope, member, { kind: "item", ref: commentRef(id) }, why, false, subjectOf("Comment on a post", comment.author, comment.body));
  } else {
    const id = idOf(body.id);
    const post = await visiblePost(scope, member, id);
    await reportTarget(scope, member, { kind: "item", ref: postRef(id) }, why, false, subjectOf("Community post", post.author, post.body));
  }
  return { message: "Report sent." };
}
async function photoStart(scope: string, member: string, body: Record<string, unknown>) {
  if (!PHOTO_TYPES.includes(String(body.contentType)) || typeof body.sizeBytes !== "number" || body.sizeBytes > MAX_PHOTO_BYTES) throw new CrmProblem("Choose a PNG, JPEG or WebP photo under 5 MB.");
  const link = await startUpload(body);
  if (isFake()) fakeUploads().push({ scope, fileId: link.fileId, person: member });
  else {
    const sql = crmDatabase();
    // Photos that never reached a post stop holding a row once their storage link is long dead.
    await sql`delete from crm_feed_upload where started_at < now() - interval '1 day'`;
    await sql`insert into crm_feed_upload (scope, file_id, person) values (${scope}, ${link.fileId}, ${member})`;
  }
  return link;
}
async function photoFinish(scope: string, member: string, body: Record<string, unknown>) {
  const fileId = body.fileId;
  const mine = isFake()
    ? fakeUploads().some(u => u.scope === scope && u.fileId === fileId && u.person === member)
    : typeof fileId === "string" && (await crmDatabase()`select 1 from crm_feed_upload where scope = ${scope} and file_id = ${fileId} and person = ${member}`).length > 0;
  if (!mine) throw new CrmProblem("Start a new photo upload.", 403);
  const id = fileId as string;
  const photo = await finishUpload(id);
  // The size sent at start is the browser's claim; check the file that actually arrived.
  const problem = photo.kind !== "image" || !PHOTO_TYPES.includes(photo.contentType) ? "Choose a PNG, JPEG or WebP photo." : photo.sizeBytes > MAX_PHOTO_BYTES ? "Choose a photo under 5 MB." : "";
  if (problem) { await discard(id); throw new CrmProblem(problem); }
  if (isFake()) fakeUploads().find(u => u.fileId === id)!.file = photo;
  else await crmDatabase()`update crm_feed_upload set file = ${JSON.stringify(photo)}::text::jsonb where scope = ${scope} and file_id = ${id} and person = ${member}`;
  return { fileId: id, url: photo.url };
}

export async function feedAction(scope: string, member: string, body: Record<string, unknown>) {
  switch (body.action) {
    case "post": return createPost(scope, member, body);
    case "edit": return editPost(scope, member, body);
    case "delete": return deletePost(scope, member, body);
    case "like": case "unlike": return setLike(scope, member, body);
    case "comment": return addComment(scope, member, body);
    case "edit-comment": return editComment(scope, member, body);
    case "delete-comment": return deleteComment(scope, member, body);
    case "follow": case "unfollow": return setFollow(scope, member, body);
    case "report": return reportContent(scope, member, body);
    case "block": return moderate(scope, member, { action: "block", ref: body.person });
    case "photo-start": return photoStart(scope, member, body);
    case "photo-finish": return photoFinish(scope, member, body);
    default: throw new CrmProblem("Choose an action to continue.");
  }
}
