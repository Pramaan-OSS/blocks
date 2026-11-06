import "server-only";
import { randomUUID } from "node:crypto";
import type { Results } from "@pramaan/sdk";
import { crmDatabase, fakeRows, text, CrmProblem } from "@/lib/pramaan/crm-data";
import { capability } from "@/lib/pramaan/server";
import { clientIp, limitPublic, verifyPublicBot, PUBLIC_READ_LIMIT, PUBLIC_WINDOW_MS } from "@/lib/pramaan/public-guard";
import { blockedEitherWay, checkNewText, isHidden } from "@/lib/pramaan/moderation";
import { listingSubjectOf } from "@/lib/pramaan/social-context";
import { startUpload, finishUpload, deleteUpload, type StoredFile } from "@/lib/pramaan/upload";

/** Edit this list for your own marketplace, job board or directory. */
export const LISTING_CATEGORIES = ["Jobs", "Services", "For sale", "Housing", "Community"];
export const PAGE_SIZE = 20;
const MAX_PAGE = 500;
const MAX_PHOTOS = 6;
const MAX_OWN = 200;
const HOUR_MS = 3_600_000;
/** A listing with six photos takes thirteen writes, so this route allows more than the shared public limit. */
const LISTING_WRITE_LIMIT = 30;
const PHOTO_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_PHOTO_BYTES = 5_000_000;

type Row = {
  scope: string; id: string; owner: string; status: "open" | "closed"; revision: number; title: string; description: string; category: string;
  priceText: string; price?: number; location: string; place?: string; latitude?: number; longitude?: number;
  photos: StoredFile[]; pendingPhoto?: string; createdAt: string;
};
/** What anyone may see in a search result. */
export type ListingCard = { id: string; title: string; excerpt: string; category: string; price: string; location: string; photoUrl?: string; postedAt: string };
export type ListingResults = { results: ListingCard[]; page: number; pages: number; total: number; categories: string[] };
/** What anyone may see on a listing page. `poster` goes only to signed-in people, for reporting or blocking. */
export type ListingPage = Omit<ListingCard, "excerpt" | "photoUrl"> & { description: string; status: Row["status"]; photoUrls: string[]; mine: boolean; hidden: boolean; signedIn: boolean; safetyRef: string; poster?: string };
/** The owner's own view, for editing. */
export type OwnListing = Pick<Row, "id" | "revision" | "status" | "title" | "description" | "category" | "priceText" | "location"> & { price?: number; photos: { fileId: string; url?: string }[]; hidden: boolean; postedAt: string };
export type OwnListings = { listings: OwnListing[]; categories: string[] };

const isFake = () => process.env.PRAMAAN_FAKE === "1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
export const listingRef = (id: string) => `listing:${id}`;
const missing = () => new CrmProblem("This listing isn't available.", 404);
const fake = () => fakeRows<Row>("crm_listing");
const live = (file: StoredFile) => file.url && Date.parse(file.expiresAt) > Date.now() ? file.url : undefined;
const priceLabel = (row: Row) => row.priceText || (row.price === undefined ? "" : String(row.price));

function fromRow(row: Record<string, any>): Row {
  return {
    scope: row.scope, id: row.id, owner: row.owner, status: row.status, revision: row.revision, title: row.title, description: row.description, category: row.category,
    priceText: row.price_text, ...(row.price === null ? {} : { price: Number(row.price) }), location: row.location,
    ...(row.place ? { place: row.place } : {}), ...(row.latitude === null ? {} : { latitude: row.latitude, longitude: row.longitude }),
    photos: row.photos, ...(row.pending_photo ? { pendingPhoto: row.pending_photo } : {}), createdAt: new Date(row.created_at).toISOString(),
  };
}
function card(row: Row): ListingCard {
  const photoUrl = row.photos.map(live).find(Boolean);
  return { id: row.id, title: row.title, excerpt: row.description.slice(0, 240), category: row.category, price: priceLabel(row), location: row.location, ...(photoUrl ? { photoUrl } : {}), postedAt: row.createdAt };
}
function ownView(row: Row, hidden: boolean): OwnListing {
  const { id, revision, status, title, description, category, priceText, price, location, createdAt } = row;
  return { id, revision, status, title, description, category, priceText, ...(price === undefined ? {} : { price }), location, photos: row.photos.map(f => ({ fileId: f.fileId, url: live(f) })), hidden, postedAt: createdAt };
}
export { blockedEitherWay };
export async function findListing(scope: string, id: string): Promise<Row | undefined> {
  if (isFake()) { const row = fake().find(l => l.scope === scope && l.id === id); return row && structuredClone(row); }
  const [row] = await crmDatabase()`select * from crm_listing where scope = ${scope} and id = ${id}`;
  return row && fromRow(row);
}
async function ownedListing(scope: string, member: string, id: unknown) {
  if (!isUuid(id)) throw missing();
  const row = await findListing(scope, id);
  if (row?.owner !== member) throw missing();
  return row;
}
/** Listing routes share one guard: origin, rate limit by client, then the optional bot check. */
export async function protectListings(request: Request, body: Record<string, unknown> = {}) {
  const write = request.method !== "GET";
  if (write) {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(process.env.PRAMAAN_SOCIAL_ORIGIN || request.url).origin) throw new CrmProblem("Please reload the page and try again.", 403);
  }
  // Count first, so a flood of requests cannot run up bot-check calls.
  limitPublic(`listings:${request.method}`, clientIp(request), write ? LISTING_WRITE_LIMIT : PUBLIC_READ_LIMIT, PUBLIC_WINDOW_MS);
  if (write) await verifyPublicBot(request, body.botCheckToken);
}

function amount(value: unknown, label = "a price") {
  if (value === undefined || value === null || value === "") return undefined;
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n >= 1e12) throw new CrmProblem(`Enter ${label} as a number of 0 or more.`);
  return Math.round(n * 100) / 100;
}
function chooseCategory(value: unknown, required: boolean) {
  if (!required && !value) return "";
  if (typeof value !== "string" || !LISTING_CATEGORIES.includes(value)) throw new CrmProblem("Choose a category from the list.");
  return value;
}
function listingFields(body: Record<string, unknown>) {
  return {
    title: text(body.title, "a title", 120), description: text(body.description, "a description", 5000), category: chooseCategory(body.category, true),
    priceText: text(body.priceText ?? "", "price or pay text", 60, false), price: amount(body.price), location: text(body.location ?? "", "a location", 120, false),
  };
}
/** Off by default. A failed lookup never stops a save: the typed location stays and still filters. */
async function findPlace(location: string): Promise<Pick<Row, "place" | "latitude" | "longitude">> {
  if (process.env.PRAMAAN_LISTING_GEOCODE !== "1" || !location) return {};
  try {
    const found = await capability<Results["geo.address.geocode"]>("geo.address.geocode", { address: location });
    return { place: found.displayName.slice(0, 200), latitude: found.latitude, longitude: found.longitude };
  } catch { return {}; }
}

async function searchRows(scope: string, viewer: string | undefined, f: { q: string; category: string; location: string; min?: number; max?: number; page: number }) {
  const skip = (f.page - 1) * PAGE_SIZE;
  if (isFake()) {
    const words = f.q.toLowerCase().split(/\s+/).filter(Boolean);
    const place = f.location.toLowerCase();
    const shown: Row[] = [];
    for (const row of fake().filter(l => l.scope === scope && l.status === "open")) {
      if (await isHidden(listingRef(row.id), scope) || await blockedEitherWay(viewer, row.owner, scope)) continue;
      const haystack = `${row.title} ${row.description} ${row.category}`.toLowerCase();
      if (!words.every(w => haystack.includes(w))) continue;
      if (f.category && row.category !== f.category) continue;
      if (place && !`${row.location} ${row.place ?? ""}`.toLowerCase().includes(place)) continue;
      if ((f.min !== undefined || f.max !== undefined) && (row.price === undefined || row.price < (f.min ?? 0) || row.price > (f.max ?? Infinity))) continue;
      shown.push(row);
    }
    shown.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    return { rows: shown.slice(skip, skip + PAGE_SIZE).map(r => structuredClone(r)), total: shown.length };
  }
  const sql = crmDatabase();
  const like = `%${f.location.replace(/[\\%_]/g, "\\$&")}%`;
  // Filter here, not after the page is cut: pages stay full and the count never reveals a hidden row.
  // ponytail: offset paging and a window count; move to keyset paging when one community keeps far more rows.
  const rows = await sql`select l.*, count(*) over() as total from crm_listing l
    where l.scope = ${scope} and l.status = 'open'
      and not exists (select 1 from crm_hidden_item h where h.scope = l.scope and h.ref = 'listing:' || l.id::text)
      ${viewer ? sql`and not exists (select 1 from crm_block b where b.scope = l.scope and ((b.viewer = ${viewer} and b.other = l.owner) or (b.viewer = l.owner and b.other = ${viewer})))` : sql``}
      ${f.q ? sql`and l.search @@ websearch_to_tsquery('english', ${f.q})` : sql``}
      ${f.category ? sql`and l.category = ${f.category}` : sql``}
      ${f.location ? sql`and (l.location ilike ${like} or l.place ilike ${like})` : sql``}
      ${f.min !== undefined ? sql`and l.price >= ${f.min}` : sql``}
      ${f.max !== undefined ? sql`and l.price <= ${f.max}` : sql``}
    order by l.created_at desc, l.id desc limit ${PAGE_SIZE} offset ${skip}`;
  return { rows: rows.map(fromRow), total: rows.length ? Number(rows[0].total) : 0 };
}
/** Public: open listings only, without hidden or blocked ones or who posted them. */
export async function searchListings(scope: string, params: URLSearchParams, viewer?: string): Promise<ListingResults> {
  const asked = Number(params.get("page") ?? 1);
  const page = Number.isInteger(asked) && asked >= 1 && asked <= MAX_PAGE ? asked : 1;
  const min = amount(params.get("min"), "a lowest price"), max = amount(params.get("max"), "a highest price");
  if (min !== undefined && max !== undefined && min > max) throw new CrmProblem("Make the lowest price smaller than the highest.");
  const filters = { q: text(params.get("q") ?? "", "search words", 200, false), category: chooseCategory(params.get("category"), false), location: text(params.get("location") ?? "", "a location", 120, false), min, max, page };
  const { rows, total } = await searchRows(scope, viewer, filters);
  // Listings can close while someone pages; past the end, go back to the start rather than say nothing matches.
  if (!rows.length && page > 1) { const first = new URLSearchParams(params); first.delete("page"); return searchListings(scope, first, viewer); }
  return { results: rows.map(card), page, pages: Math.min(Math.ceil(total / PAGE_SIZE), MAX_PAGE), total, categories: LISTING_CATEGORIES };
}
/** One listing. A closed one stays readable by link; a hidden or blocked one exists only for its owner. */
export async function listingPage(scope: string, id: string, viewer?: string): Promise<ListingPage> {
  const row = isUuid(id) ? await findListing(scope, id) : undefined;
  if (!row) throw missing();
  const mine = row.owner === viewer;
  const hidden = await isHidden(listingRef(id), scope);
  if (!mine && (hidden || await blockedEitherWay(viewer, row.owner, scope))) throw missing();
  const { photoUrl: _first, excerpt: _excerpt, ...shown } = card(row);
  return { ...shown, description: row.description, status: row.status, photoUrls: row.photos.flatMap(f => live(f) ?? []), mine, hidden, signedIn: !!viewer, safetyRef: listingRef(id), ...(viewer && !mine ? { poster: row.owner } : {}) };
}
export async function ownListings(scope: string, member: string): Promise<OwnListings> {
  const categories = LISTING_CATEGORIES;
  if (isFake()) {
    const rows = fake().filter(l => l.scope === scope && l.owner === member).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, MAX_OWN);
    return { listings: await Promise.all(rows.map(async r => ownView(structuredClone(r), await isHidden(listingRef(r.id), scope)))), categories };
  }
  // ponytail: the newest 200 of one person's listings; add paging when a poster keeps more.
  const rows = await crmDatabase()`select l.*, exists (select 1 from crm_hidden_item h where h.scope = l.scope and h.ref = 'listing:' || l.id::text) as hidden
    from crm_listing l where l.scope = ${scope} and l.owner = ${member} order by l.created_at desc limit ${MAX_OWN}`;
  return { listings: rows.map(r => ownView(fromRow(r), r.hidden)), categories };
}

const changed = () => new CrmProblem("This listing changed since you opened it. Reload to see the latest.", 409);
const closed = () => new CrmProblem("This listing is closed.", 409);
export async function saveListing(scope: string, member: string, body: Record<string, unknown>) {
  const fields = listingFields(body);
  const sql = isFake() ? undefined : crmDatabase();
  if (body.id === undefined) {
    limitPublic("listing-post", member, 20, HOUR_MS);
    const id = randomUUID();
    // Queue before saving: if queue storage fails, no unreviewed new text is committed.
    await checkNewText(scope, { kind: "item", ref: listingRef(id) }, `${fields.title}\n${fields.description}`, listingSubjectOf(fields));
    const geo = await findPlace(fields.location);
    if (!sql) { fake().push({ scope, id, owner: member, status: "open", revision: 1, ...fields, ...geo, photos: [], createdAt: new Date().toISOString() }); return { id }; }
    await sql`insert into crm_listing (scope, id, owner, title, description, category, price_text, price, location, place, latitude, longitude)
      values (${scope}, ${id}, ${member}, ${fields.title}, ${fields.description}, ${fields.category}, ${fields.priceText}, ${fields.price ?? null}, ${fields.location}, ${geo.place ?? null}, ${geo.latitude ?? null}, ${geo.longitude ?? null})`;
    return { id };
  }
  const row = await ownedListing(scope, member, body.id);
  if (row.status !== "open") throw closed();
  if (body.revision !== row.revision) throw changed();
  await checkNewText(scope, { kind: "item", ref: listingRef(row.id) }, `${fields.title}\n${fields.description}`, listingSubjectOf(fields));
  const geo = fields.location === row.location ? { place: row.place, latitude: row.latitude, longitude: row.longitude } : await findPlace(fields.location);
  if (!sql) {
    const stored = fake().find(l => l.scope === scope && l.id === row.id)!;
    if (stored.revision !== row.revision) throw changed();
    Object.assign(stored, fields, { place: undefined, latitude: undefined, longitude: undefined }, geo, { revision: row.revision + 1 });
    return { id: row.id };
  }
  // The revision condition makes one of two concurrent saves of the same version win.
  const [saved] = await sql`update crm_listing set revision = revision + 1, title = ${fields.title}, description = ${fields.description}, category = ${fields.category},
      price_text = ${fields.priceText}, price = ${fields.price ?? null}, location = ${fields.location}, place = ${geo.place ?? null}, latitude = ${geo.latitude ?? null}, longitude = ${geo.longitude ?? null}, updated_at = now()
    where scope = ${scope} and id = ${row.id} and revision = ${row.revision} and status = 'open' returning id`;
  if (!saved) throw changed();
  return { id: row.id };
}
export async function closeListing(scope: string, member: string, id: unknown) {
  const row = await ownedListing(scope, member, id);
  if (isFake()) Object.assign(fake().find(l => l.scope === scope && l.id === row.id)!, { status: "closed", revision: row.revision + (row.status === "open" ? 1 : 0) });
  else await crmDatabase()`update crm_listing set status = 'closed', revision = revision + 1, closed_at = now(), updated_at = now() where scope = ${scope} and id = ${row.id} and status = 'open'`;
  return { id: row.id };
}

const discard = (fileId: string) => deleteUpload(fileId).catch(() => undefined);
export async function startListingPhoto(scope: string, member: string, body: Record<string, unknown>) {
  const row = await ownedListing(scope, member, body.id);
  if (row.status !== "open") throw closed();
  if (row.photos.length >= MAX_PHOTOS) throw new CrmProblem(`A listing can have ${MAX_PHOTOS} photos. Remove one to add another.`);
  if (!PHOTO_TYPES.includes(String(body.contentType)) || typeof body.sizeBytes !== "number" || body.sizeBytes > MAX_PHOTO_BYTES) throw new CrmProblem("Choose a PNG, JPEG or WebP photo under 5 MB.");
  limitPublic("listing-photo", member, 30, HOUR_MS);
  const link = await startUpload(body);
  if (isFake()) fake().find(l => l.scope === scope && l.id === row.id)!.pendingPhoto = link.fileId;
  else await crmDatabase()`update crm_listing set pending_photo = ${link.fileId}, updated_at = now() where scope = ${scope} and id = ${row.id}`;
  return link;
}
export async function finishListingPhoto(scope: string, member: string, body: Record<string, unknown>) {
  const row = await ownedListing(scope, member, body.id);
  if (typeof body.fileId !== "string" || row.pendingPhoto !== body.fileId) throw new CrmProblem("Start a new photo upload.", 403);
  const photo = await finishUpload(body.fileId);
  // The size sent at start is the browser's claim; check the file that actually arrived.
  if (photo.kind !== "image" || !PHOTO_TYPES.includes(photo.contentType) || photo.sizeBytes > MAX_PHOTO_BYTES) { await discard(body.fileId); throw new CrmProblem("Choose a PNG, JPEG or WebP photo under 5 MB."); }
  const full = () => new CrmProblem(`A listing can have ${MAX_PHOTOS} photos. Remove one to add another.`, 409);
  if (isFake()) {
    const stored = fake().find(l => l.scope === scope && l.id === row.id)!;
    if (stored.photos.length >= MAX_PHOTOS) throw full();
    stored.photos.push(photo); delete stored.pendingPhoto; stored.revision++;
    return { id: row.id };
  }
  const [saved] = await crmDatabase()`update crm_listing set photos = photos || ${JSON.stringify(photo)}::text::jsonb, pending_photo = null, revision = revision + 1, updated_at = now()
    where scope = ${scope} and id = ${row.id} and pending_photo = ${body.fileId} and jsonb_array_length(photos) < ${MAX_PHOTOS} returning id`;
  if (!saved) { await discard(body.fileId); throw full(); }
  return { id: row.id };
}
export async function removeListingPhoto(scope: string, member: string, body: Record<string, unknown>) {
  const row = await ownedListing(scope, member, body.id);
  const photos = row.photos.filter(f => f.fileId !== body.fileId);
  if (photos.length === row.photos.length) throw new CrmProblem("This photo is no longer available.", 404);
  if (isFake()) Object.assign(fake().find(l => l.scope === scope && l.id === row.id)!, { photos, revision: row.revision + 1 });
  else {
    const [saved] = await crmDatabase()`update crm_listing set photos = ${JSON.stringify(photos)}::text::jsonb, revision = revision + 1, updated_at = now()
      where scope = ${scope} and id = ${row.id} and revision = ${row.revision} returning id`;
    if (!saved) throw changed();
  }
  await discard(String(body.fileId));
  return { id: row.id };
}
