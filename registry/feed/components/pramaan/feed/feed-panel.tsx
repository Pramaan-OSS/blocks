"use client";
import { useEffect, useState, type FormEvent } from "react";
import { Heart, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmAction } from "@/components/pramaan/confirm-action";
import { EmptyState, ErrorState, LoadingState, SignedOutState, StatusMessage } from "@/components/pramaan/states";
import { ApiError, api } from "@/lib/pramaan/client";
import { formatDate } from "@/lib/pramaan/plain";
import type { FeedComment, FeedPage, FeedPost, PersonPage } from "@/lib/pramaan/feed";
import type { UploadLink } from "@/lib/pramaan/upload";

type Token = () => Promise<string>;
const URL_BASE = "/api/pramaan/feed";
const PHOTO_LIMIT = 4;
const errorText = (e: unknown) => e instanceof Error ? e.message : "Couldn't finish that. Try again.";
async function send<T>(body: Record<string, unknown>, getBotCheckToken?: Token) {
  return api<T>(URL_BASE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, botCheckToken: await getBotCheckToken?.() }) });
}
/** Loads the first page, and keeps what "Show more" and each action change. */
function usePosts<T extends FeedPage>(url: string) {
  const [first, setFirst] = useState<T>();
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [next, setNext] = useState<string>();
  const [error, setError] = useState<ApiError>();
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    api<T>(url).then(page => {
      if (!live) return;
      setFirst(page); setPosts(page.posts); setNext(page.nextCursor); setError(undefined);
    }, (e: ApiError) => { if (live) setError(e); });
    return () => { live = false; };
  }, [url, tick]);
  async function more() {
    if (!next || busy) return;
    setBusy(true);
    try {
      const page = await api<FeedPage>(`${url}${url.includes("?") ? "&" : "?"}cursor=${encodeURIComponent(next)}`);
      setPosts(all => [...all, ...page.posts.filter(p => !all.some(a => a.id === p.id))]); setNext(page.nextCursor);
    } catch (e) { setError(e as ApiError); }
    finally { setBusy(false); }
  }
  return { first, posts, setPosts, next, more, busy, error, reload: () => setTick(t => t + 1) };
}
/** Text and up to four photos, each uploaded straight to storage before the post is saved. */
function Composer({ onPosted, getBotCheckToken }: { onPosted: (post: FeedPost) => void; getBotCheckToken?: Token }) {
  const [draft, setDraft] = useState("");
  const [photos, setPhotos] = useState<{ fileId: string; url?: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function attach(file?: File) {
    if (!file || busy) return;
    setBusy(true); setMessage("");
    try {
      const link = await send<UploadLink>({ action: "photo-start", contentType: file.type, sizeBytes: file.size }, getBotCheckToken);
      const response = await fetch(link.uploadUrl, { method: "PUT", headers: link.headers, body: file });
      if (!response.ok) throw new Error("The photo didn't upload. Try again.");
      const photo = await send<{ fileId: string; url?: string }>({ action: "photo-finish", fileId: link.fileId }, getBotCheckToken);
      setPhotos(all => [...all, photo]); setMessage("Photo added.");
    } catch (e) { setMessage(errorText(e)); }
    finally { setBusy(false); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !draft.trim()) return;
    setBusy(true); setMessage("");
    try {
      onPosted(await send<FeedPost>({ action: "post", text: draft, photos: photos.map(p => p.fileId) }, getBotCheckToken));
      setDraft(""); setPhotos([]); setMessage("Posted.");
    } catch (e) { setMessage(errorText(e)); }
    finally { setBusy(false); }
  }
  return <form aria-label="New post" onSubmit={submit} className="pr-card space-y-3">
    <Label htmlFor="pramaan-new-post">Share something</Label>
    <Textarea id="pramaan-new-post" required maxLength={2000} rows={3} value={draft} disabled={busy} onChange={e => setDraft(e.target.value)} />
    {!!photos.length && <ul aria-label="Photos to post" className="flex flex-wrap gap-2">{photos.map((p, i) => <li key={p.fileId} className="space-y-1">
      {p.url && <img src={p.url} alt={`Photo ${i + 1} to post`} width={96} height={96} className="rounded object-cover" />}
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setPhotos(all => all.filter(x => x.fileId !== p.fileId))}>Remove photo {i + 1}</Button>
    </li>)}</ul>}
    <div className="flex flex-wrap items-center gap-3">
      <Button type="submit" disabled={busy || !draft.trim()}>Post</Button>
      <label className="text-sm">Add a photo <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy || photos.length >= PHOTO_LIMIT} className="block" onChange={event => { void attach(event.target.files?.[0]); event.target.value = ""; }} /></label>
    </div>
    <p className="text-sm text-muted-foreground">PNG, JPEG or WebP, up to 5 MB each and four to a post. Photos can't be changed after posting and are kept for 7 days.</p>
    <StatusMessage text={message} />
  </form>;
}
function ReportForm({ label, onSend }: { label: string; onSend: (reason: string) => Promise<void> }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    setBusy(true); setMessage("");
    try { await onSend(String(new FormData(form).get("reason"))); form.reset(); setMessage("Report sent."); }
    catch (e) { setMessage(errorText(e)); }
    finally { setBusy(false); }
  }
  return <details className="text-sm"><summary className="cursor-pointer">Report {label}</summary>
    <form onSubmit={submit} className="mt-2 space-y-2">
      <label className="block">Why are you reporting this?<Textarea required maxLength={1000} name="reason" disabled={busy} /></label>
      <Button type="submit" size="sm" variant="outline" disabled={busy}>Send report</Button>
      <StatusMessage text={message} />
    </form>
  </details>;
}
const who = (item: { mine: boolean; author: { name?: string } }) => item.mine ? "You" : item.author.name || "Community member";
function When({ at, editedAt }: { at: string; editedAt?: string }) {
  return <p className="text-xs text-muted-foreground"><time dateTime={at}>{formatDate(at, { time: true })}</time>{editedAt && " · Edited"}</p>;
}
function Comments({ post, getBotCheckToken, onCount }: { post: FeedPost; getBotCheckToken?: Token; onCount: (count: number) => void }) {
  const [comments, setComments] = useState<FeedComment[]>();
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<FeedComment>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const load = () => api<{ comments: FeedComment[] }>(`${URL_BASE}?post=${encodeURIComponent(post.id)}`).then(r => { setComments(r.comments); return r.comments; });
  useEffect(() => { void load().catch(e => setMessage(errorText(e))); }, [post.id]);
  async function act(body: Record<string, unknown>) {
    if (busy) return false;
    setBusy(true); setMessage("");
    try { await send(body, getBotCheckToken); onCount((await load()).length); return true; }
    catch (e) { setMessage(errorText(e)); return false; }
    finally { setBusy(false); }
  }
  return <section aria-label="Comments" className="space-y-3 border-t pt-3">
    {comments && !comments.length && <p className="text-sm text-muted-foreground">No comments yet.</p>}
    <ul className="space-y-3">{comments?.map(c => <li key={c.id} className="space-y-1 text-sm">
      <p className="font-medium">{who(c)}</p>
      {editing?.id === c.id
        ? <form className="space-y-2" onSubmit={async event => { event.preventDefault(); if (await act({ action: "edit-comment", id: c.id, text: editing.text })) setEditing(undefined); }}>
            <Label htmlFor={`pramaan-comment-${c.id}`}>Edit comment</Label>
            <Textarea id={`pramaan-comment-${c.id}`} required maxLength={1000} value={editing.text} disabled={busy} onChange={e => setEditing({ ...editing, text: e.target.value })} />
            <div className="flex gap-2"><Button type="submit" size="sm" disabled={busy}>Save comment</Button><Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setEditing(undefined)}>Cancel</Button></div>
          </form>
        : <p className="whitespace-pre-wrap">{c.text}</p>}
      <When at={c.at} editedAt={c.editedAt} />
      {c.mine
        ? editing?.id !== c.id && <div className="flex gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing(c)}>Edit comment</Button><ConfirmAction label="Delete comment" title="Delete this comment?" description="This can't be undone." variant="outline" disabled={busy} onConfirm={() => void act({ action: "delete-comment", id: c.id })} /></div>
        : <ReportForm label="comment" onSend={reason => send({ action: "report", target: "comment", id: c.id, reason }, getBotCheckToken).then(() => undefined)} />}
    </li>)}</ul>
    <form className="space-y-2" onSubmit={async event => { event.preventDefault(); if (await act({ action: "comment", id: post.id, text: draft })) setDraft(""); }}>
      <Label htmlFor={`pramaan-reply-${post.id}`}>Add a comment</Label>
      <Textarea id={`pramaan-reply-${post.id}`} required maxLength={1000} rows={2} value={draft} disabled={busy} onChange={e => setDraft(e.target.value)} />
      <Button type="submit" size="sm" disabled={busy || !draft.trim()}>Comment</Button>
    </form>
    <StatusMessage text={message} />
  </section>;
}
function PostCard({ post, profilesHref, onChange, onRemove, onBlocked, getBotCheckToken }: { post: FeedPost; profilesHref: string; onChange: (post: FeedPost) => void; onRemove: () => void; onBlocked: (person: string) => void; getBotCheckToken?: Token }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function act(run: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setMessage("");
    try { await run(); }
    catch (e) { setMessage(errorText(e)); }
    finally { setBusy(false); }
  }
  const update = (body: Record<string, unknown>) => act(async () => { onChange(await send<FeedPost>(body, getBotCheckToken)); setEditing(undefined); });
  return <article aria-label={`Post by ${who(post)}`} className="pr-card space-y-3">
    <div>
      <a className="font-medium hover:underline" href={`${profilesHref}/${encodeURIComponent(post.author.ref)}`}>{who(post)}</a>
      <When at={post.at} editedAt={post.editedAt} />
    </div>
    {editing === undefined
      ? <p className="whitespace-pre-wrap">{post.text}</p>
      : <form className="space-y-2" onSubmit={event => { event.preventDefault(); void update({ action: "edit", id: post.id, revision: post.revision, text: editing }); }}>
          <Label htmlFor={`pramaan-edit-${post.id}`}>Edit post</Label>
          <Textarea id={`pramaan-edit-${post.id}`} required maxLength={2000} value={editing} disabled={busy} onChange={e => setEditing(e.target.value)} />
          <div className="flex gap-2"><Button type="submit" size="sm" disabled={busy}>Save post</Button><Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setEditing(undefined)}>Cancel</Button></div>
        </form>}
    {!!post.photos.length && <div className="grid grid-cols-2 gap-2">{post.photos.map((photo, i) => <img key={photo.url} src={photo.url} alt={`Photo ${i + 1} of ${post.photos.length} in this post`} className="max-h-96 w-full rounded object-cover" />)}</div>}
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" aria-pressed={post.liked} disabled={busy} onClick={() => void update({ action: post.liked ? "unlike" : "like", id: post.id })}><Heart aria-hidden className="size-4" fill={post.liked ? "currentColor" : "none"} />{post.liked ? "Liked" : "Like"} · {post.likes}</Button>
      <Button size="sm" variant="outline" aria-expanded={open} onClick={() => setOpen(o => !o)}><MessageCircle aria-hidden className="size-4" />Comments · {post.comments}</Button>
      {post.mine && editing === undefined && <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing(post.text)}>Edit post</Button>}
      {post.mine && <ConfirmAction label="Delete post" title="Delete this post?" description="Its photos, likes and comments go with it. This can't be undone." variant="outline" disabled={busy} onConfirm={() => act(async () => { await send({ action: "delete", id: post.id }, getBotCheckToken); onRemove(); })} />}
      {!post.mine && <ConfirmAction label="Block person" title={`Block ${who(post)}?`} description="You won't see each other's posts, and you can't message each other. You can unblock them later." variant="outline" disabled={busy} onConfirm={() => act(async () => { await send({ action: "block", person: post.author.ref }, getBotCheckToken); onBlocked(post.author.ref); })} />}
    </div>
    {!post.mine && <ReportForm label="post" onSend={reason => send({ action: "report", target: "post", id: post.id, reason }, getBotCheckToken).then(() => undefined)} />}
    <StatusMessage text={message} />
    {open && <Comments post={post} getBotCheckToken={getBotCheckToken} onCount={comments => onChange({ ...post, comments })} />}
  </article>;
}
function PostList({ feed, profilesHref, getBotCheckToken }: { feed: Omit<ReturnType<typeof usePosts>, "first">; profilesHref: string; getBotCheckToken?: Token }) {
  const { posts, setPosts, next, more, busy, error } = feed;
  return <>
    <div className="space-y-4">{posts.map(post => <PostCard key={post.id} post={post} profilesHref={profilesHref} getBotCheckToken={getBotCheckToken}
      onChange={changed => setPosts(all => all.map(p => p.id === changed.id ? changed : p))}
      onRemove={() => setPosts(all => all.filter(p => p.id !== post.id))}
      onBlocked={person => setPosts(all => all.filter(p => p.author.ref !== person))} />)}</div>
    {next && <Button variant="outline" disabled={busy} onClick={() => void more()}>Show more</Button>}
    <StatusMessage tone="error" text={error?.message} />
  </>;
}
/** The home feed: your own posts and the people you follow, newest first. */
export function FeedPanel({ profilesHref = "/profiles", getBotCheckToken }: { profilesHref?: string; getBotCheckToken?: Token } = {}) {
  const feed = usePosts(URL_BASE);
  if (feed.error?.status === 401) return <SignedOutState reason="Your feed shows posts from the people you follow." />;
  if (feed.error && !feed.first) return <ErrorState error={feed.error} onRetry={feed.reload} />;
  if (!feed.first) return <LoadingState label="Loading your feed" />;
  return <section aria-label="Your feed" className="max-w-2xl space-y-4">
    <Composer getBotCheckToken={getBotCheckToken} onPosted={post => feed.setPosts(all => [post, ...all])} />
    {!feed.posts.length && <EmptyState title="Nothing here yet">Write your first post, or follow someone from their profile page.</EmptyState>}
    <PostList feed={feed} profilesHref={profilesHref} getBotCheckToken={getBotCheckToken} />
  </section>;
}
/** A person's posts, with Follow, for their profile page. Pass `messagesHref` when the app has messaging. */
export function PersonPosts({ person, profilesHref = "/profiles", messagesHref, getBotCheckToken }: { person: string; profilesHref?: string; messagesHref?: string; getBotCheckToken?: Token }) {
  const feed = usePosts<PersonPage>(`${URL_BASE}?person=${encodeURIComponent(person)}`);
  const [following, setFollowing] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  if (feed.error?.status === 401) return <SignedOutState reason="Members can see this person's posts." />;
  // Blocked either way: the profile above already says it isn't available.
  if (feed.error?.status === 404) return null;
  if (feed.error && !feed.first) return <ErrorState error={feed.error} onRetry={feed.reload} />;
  if (!feed.first) return <LoadingState label="Loading posts" />;
  const isFollowing = following ?? feed.first.following;
  async function follow() {
    if (busy) return;
    setBusy(true); setMessage("");
    try { await send({ action: isFollowing ? "unfollow" : "follow", person }, getBotCheckToken); setFollowing(!isFollowing); }
    catch (e) { setMessage(errorText(e)); }
    finally { setBusy(false); }
  }
  return <section aria-label="Posts" className="max-w-2xl space-y-4">
    {!feed.first.self && <div className="flex flex-wrap items-center gap-2">
      <Button variant={isFollowing ? "outline" : "default"} disabled={busy} onClick={() => void follow()}>{isFollowing ? "Unfollow" : "Follow"}</Button>
      {messagesHref && <a className="pr-link" href={`${messagesHref}?with=${encodeURIComponent(person)}`}>Message</a>}
    </div>}
    <StatusMessage text={message} />
    <h2 className="font-serif text-xl">Posts</h2>
    {!feed.posts.length && <p className="text-sm text-muted-foreground">No posts yet.</p>}
    <PostList feed={feed} profilesHref={profilesHref} getBotCheckToken={getBotCheckToken} />
  </section>;
}
