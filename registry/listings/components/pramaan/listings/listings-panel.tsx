"use client";
import { useState, type FormEvent } from "react";
import { api, useResource } from "@/lib/pramaan/client";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/pramaan/parts";
import { ConfirmAction } from "@/components/pramaan/confirm-action";
import { SafetyActions } from "@/components/pramaan/moderation/moderation-panel";
import { formatDate } from "@/lib/pramaan/plain";
import type { ListingPage, ListingResults, OwnListing, OwnListings } from "@/lib/pramaan/listings";
import type { UploadLink } from "@/lib/pramaan/upload";
const field = "block w-full rounded border bg-background p-2";
const ROUTE = "/api/pramaan/listings";
const sorry = (e: unknown) => e instanceof Error ? e.message : "Couldn't finish that. Try again.";
const details = (l: { category: string; price: string; location: string }) => [l.category, l.price, l.location].filter(Boolean).join(" · ");

/** Public search with filters and paging. Hidden and blocked listings never reach this screen. */
export function ListingsBrowser() {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useResource<ListingResults>(`${ROUTE}?${query}${query ? "&" : ""}page=${page}`);
  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const filters = new URLSearchParams();
    for (const [key, value] of new FormData(event.currentTarget)) if (String(value).trim()) filters.set(key, String(value).trim());
    setQuery(filters.toString()); setPage(1);
  }
  return <div className="space-y-6">
    <form role="search" aria-label="Find listings" onSubmit={search} className="grid gap-3 md:grid-cols-3">
      <label className="block md:col-span-3">Search<input name="q" maxLength={200} className={field} /></label>
      <label className="block">Category<select name="category" className={field}><option value="">Any category</option>{data?.categories.map(c => <option key={c}>{c}</option>)}</select></label>
      <label className="block">Location<input name="location" maxLength={120} className={field} /></label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">Lowest price<input name="min" type="number" min="0" step="any" className={field} /></label>
        <label className="block">Highest price<input name="max" type="number" min="0" step="any" className={field} /></label>
      </div>
      <div><Button type="submit">Search listings</Button></div>
    </form>
    {error && <div role="alert">{error.message} <Button variant="outline" onClick={reload}>Try again</Button></div>}
    {loading && !data && <p role="status">Loading listings…</p>}
    {data && !error && <section aria-label="Listings" className="space-y-4">
      <p role="status" aria-live="polite">{data.total === 0 ? "No listings match. Try fewer filters." : data.total === 1 ? "1 listing" : `${data.total} listings`}</p>
      <ul className="divide-y">{data.results.map(l => <li key={l.id} className="flex gap-4 py-4">
        {l.photoUrl && <img src={l.photoUrl} alt="" width={96} height={96} className="size-24 rounded object-cover" />}
        <div className="space-y-1"><h2 className="font-serif text-xl"><a className="underline" href={`/listings/${l.id}`}>{l.title}</a></h2><p className="text-sm text-muted-foreground">{details(l)}</p><p>{l.excerpt}</p></div>
      </li>)}</ul>
      {data.pages > 1 && <nav aria-label="Pages" className="flex items-center gap-3">
        <Button variant="outline" disabled={data.page <= 1} onClick={() => setPage(data.page - 1)}>Previous page</Button>
        <span>Page {data.page} of {data.pages}</span>
        <Button variant="outline" disabled={data.page >= data.pages} onClick={() => setPage(data.page + 1)}>Next page</Button>
      </nav>}
    </section>}
  </div>;
}

/** Set `withApplications` once the applications block is installed: it links its apply and applicant pages. */
export function ListingDetail({ id, withApplications = false, getBotCheckToken }: { id: string; withApplications?: boolean; getBotCheckToken?: () => Promise<string> }) {
  const { data, error, loading, reload } = useResource<ListingPage>(`${ROUTE}?id=${encodeURIComponent(id)}`);
  if (loading) return <p role="status">Loading listing…</p>;
  if (error) return <div role="alert">{error.message} <Button variant="outline" onClick={reload}>Try again</Button></div>;
  if (!data) return null;
  return <div className="space-y-6">
    <article aria-label="Listing" className="space-y-4 rounded border p-6">
      <h2 className="font-serif text-2xl">{data.title}</h2>
      <p className="text-sm text-muted-foreground">{details(data)} · Posted {formatDate(data.postedAt)}</p>
      {data.status === "closed" && <StatusPill>Closed</StatusPill>}
      {data.hidden && <p><StatusPill tone="red">Hidden</StatusPill> Only you can see this listing. A moderator hid it after a report.</p>}
      {data.photoUrls.length > 0 && <div className="flex flex-wrap gap-3">{data.photoUrls.map((url, i) => <img key={url} src={url} alt={`Photo ${i + 1} of ${data.title}`} width={240} height={180} className="rounded object-cover" />)}</div>}
      <p className="whitespace-pre-wrap">{data.description}</p>
      {withApplications && data.mine && <a className="underline" href={`/listings/${data.id}/applicants`}>See applicants</a>}
      {withApplications && !data.mine && data.status === "open" && <a className="underline" href={`/listings/${data.id}/apply`}>Apply</a>}
    </article>
    {data.poster && <div className="grid gap-4 md:grid-cols-2">
      <SafetyActions kind="item" target={data.safetyRef} label="This listing" getBotCheckToken={getBotCheckToken} />
      <SafetyActions kind="person" target={data.poster} label="The person who posted this" getBotCheckToken={getBotCheckToken} />
    </div>}
  </div>;
}

function listingStatus(l: OwnListing) {
  if (l.hidden) return <StatusPill tone="red">Hidden</StatusPill>;
  return l.status === "open" ? <StatusPill tone="green">Open</StatusPill> : <StatusPill>Closed</StatusPill>;
}
/** The signed-in person's own listings: post, edit, add photos and close. */
export function MyListings({ withApplications = false, getBotCheckToken }: { withApplications?: boolean; getBotCheckToken?: () => Promise<string> }) {
  const { data, error, loading, reload } = useResource<OwnListings>(`${ROUTE}?mine=1`);
  const [editing, setEditing] = useState<OwnListing | "new">();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const draft = typeof editing === "object" ? editing : undefined;
  const post = async <T,>(body: object) => api<T>(ROUTE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, botCheckToken: await getBotCheckToken?.() }) });
  async function run(work: () => Promise<unknown>, done: string) {
    if (busy) return false;
    setBusy(true); setMessage("");
    try { await work(); reload(); setMessage(done); return true; }
    catch (e) { reload(); setMessage(sorry(e)); return false; }
    finally { setBusy(false); }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const fields = Object.fromEntries(["title", "description", "category", "priceText", "price", "location"].map(k => [k, form.get(k)]));
    if (await run(() => post({ action: "save", ...fields, ...(draft ? { id: draft.id, revision: draft.revision } : {}) }), draft ? "Listing saved." : "Listing posted. You can add photos below.")) setEditing(undefined);
  }
  const addPhoto = (id: string, file?: File) => file && run(async () => {
    const link = await post<UploadLink>({ action: "photo-start", id, contentType: file.type, sizeBytes: file.size });
    const response = await fetch(link.uploadUrl, { method: "PUT", headers: link.headers, body: file });
    if (!response.ok) throw new Error("The photo didn't upload. Try again.");
    await post({ action: "photo-finish", id, fileId: link.fileId });
  }, "Photo added.");
  if (loading) return <p role="status">Loading your listings…</p>;
  if (error) return <div role="alert">{error.message} <Button variant="outline" onClick={reload}>Try again</Button></div>;
  return <div className="space-y-6">
    <Button disabled={busy} onClick={() => { setEditing("new"); setMessage(""); }}>Post a listing</Button>
    <p role="status" aria-live="polite">{message}</p>
    {editing && <form aria-label="Listing details" key={draft ? `${draft.id}-${draft.revision}` : "new"} onSubmit={save} className="max-w-xl space-y-3 rounded border p-4">
      <h2 className="font-serif text-xl">{draft ? "Edit listing" : "New listing"}</h2>
      <label className="block">Title<input autoFocus required maxLength={120} name="title" className={field} defaultValue={draft?.title} /></label>
      <label className="block">Description<textarea required maxLength={5000} rows={6} name="description" className={field} defaultValue={draft?.description} /></label>
      <label className="block">Category<select required name="category" className={field} defaultValue={draft?.category ?? ""}><option value="" disabled>Choose a category</option>{data?.categories.map(c => <option key={c}>{c}</option>)}</select></label>
      <label className="block">Price or pay, as you want it shown<input maxLength={60} name="priceText" placeholder="$25 an hour" className={field} defaultValue={draft?.priceText} /></label>
      <label className="block">Price as a number, for price filters<input type="number" min="0" step="0.01" name="price" className={field} defaultValue={draft?.price} /></label>
      <label className="block">Location<input maxLength={120} name="location" className={field} defaultValue={draft?.location} /></label>
      <div className="flex gap-2"><Button type="submit" disabled={busy}>Save listing</Button><Button type="button" variant="outline" disabled={busy} onClick={() => setEditing(undefined)}>Cancel</Button></div>
    </form>}
    {!data?.listings.length && <p>You haven't posted a listing yet.</p>}
    <ul aria-label="Your listings" className="divide-y">{data?.listings.map(l => <li key={l.id} className="space-y-3 py-4">
      <div className="flex flex-wrap items-center gap-3"><h2 className="font-serif text-xl"><a className="underline" href={`/listings/${l.id}`}>{l.title}</a></h2>{listingStatus(l)}</div>
      <p className="text-sm text-muted-foreground">Posted {formatDate(l.postedAt)}</p>
      {l.photos.length > 0 && <ul className="flex flex-wrap gap-3">{l.photos.map((p, i) => <li key={p.fileId} className="space-y-1">
        {p.url ? <img src={p.url} alt={`Photo ${i + 1} of ${l.title}`} width={96} height={96} className="size-24 rounded object-cover" /> : <p className="text-sm">Photo {i + 1} has expired.</p>}
        <Button variant="outline" disabled={busy} aria-label={`Remove photo ${i + 1} of ${l.title}`} onClick={() => void run(() => post({ action: "photo-remove", id: l.id, fileId: p.fileId }), "Photo removed.")}>Remove</Button>
      </li>)}</ul>}
      {l.status === "open" && <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" disabled={busy} aria-label={`Edit ${l.title}`} onClick={() => { setEditing({ ...l }); setMessage(""); }}>Edit</Button>
        <ConfirmAction label={`Close ${l.title}`} title="Close this listing?" description="It leaves search and stops taking applications. This cannot be undone." confirmLabel="Close listing" variant="outline" disabled={busy} onConfirm={() => void run(() => post({ action: "close", id: l.id }), "Listing closed.")} />
        <label className="block text-sm">Add a photo to {l.title}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} className={field} onChange={event => { void addPhoto(l.id, event.target.files?.[0]); event.target.value = ""; }} /></label>
      </div>}
      {withApplications && <a className="underline" href={`/listings/${l.id}/applicants`}>See applicants for {l.title}</a>}
    </li>)}</ul>
    <p className="text-sm text-muted-foreground">Photos are PNG, JPEG or WebP, up to 5 MB, and up to six on a listing. Uploaded files are kept 7 days.</p>
  </div>;
}
