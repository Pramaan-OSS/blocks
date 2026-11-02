import "server-only";
import { crmDatabase, fakeRows, text, CrmProblem } from "@/lib/pramaan/crm-data";
import { startUpload, finishUpload, deleteUpload, type StoredFile } from "@/lib/pramaan/upload";
import { checkNewText, isBlocked } from "@/lib/pramaan/moderation";
export type Profile = { person: string; revision: number; name: string; bio: string; links: string[]; photo?: StoredFile; pendingPhoto?: string; public: { name: boolean; bio: boolean; links: boolean; photo: boolean } };
type FakeProfile = Profile & { scope: string };
export const emptyProfile = (person: string): Profile => ({ person, revision: 0, name: "", bio: "", links: [], public: { name: false, bio: false, links: false, photo: false } });
const isFake = () => process.env.PRAMAAN_FAKE === "1";
const fakeProfile = (scope: string, person: string) => fakeRows<FakeProfile>("crm_profile").find(p => p.scope === scope && p.person === person);
function fakeCopy(row: FakeProfile): Profile {
  const { scope: _scope, ...profile } = structuredClone(row);
  return profile;
}
function fromRow(row: Record<string, any>): Profile {
  return {
    person: row.person, revision: row.revision, name: row.name, bio: row.bio, links: row.links,
    ...(row.photo ? { photo: row.photo } : {}), ...(row.pending_photo ? { pendingPhoto: row.pending_photo } : {}),
    public: { name: row.public_name, bio: row.public_bio, links: row.public_links, photo: row.public_photo },
  };
}
async function findProfile(scope: string, person: string): Promise<Profile | undefined> {
  if (isFake()) { const row = fakeProfile(scope, person); return row && fakeCopy(row); }
  const [row] = await crmDatabase()`select * from crm_profile where scope = ${scope} and person = ${person}`;
  return row && fromRow(row);
}
export async function ownProfile(scope: string, person: string) {
  return await findProfile(scope, person) ?? emptyProfile(person);
}
export async function publicProfile(scope: string, person: string, viewer?: string) {
  // Either direction hides it: the blocker stops seeing the person, and a blocked viewer sees nothing.
  if (await isBlocked(viewer, person, scope) || (viewer && await isBlocked(person, viewer, scope))) throw new CrmProblem("This profile isn't available.", 404);
  const profile = await findProfile(scope, person);
  if (!profile) throw new CrmProblem("This profile isn't available.", 404);
  return {
    ...(profile.public.name ? { name: profile.name } : {}),
    ...(profile.public.bio ? { bio: profile.bio } : {}),
    ...(profile.public.links ? { links: profile.links } : {}),
    ...(profile.public.photo && profile.photo?.url && Date.parse(profile.photo.expiresAt) > Date.now() ? { photoUrl: profile.photo.url } : {}),
  };
}
function validLinks(value: unknown) {
  if (!Array.isArray(value) || value.length > 5) throw new CrmProblem("Add up to five links.");
  return value.map(v => {
    const link = text(v, "a link", 500);
    let url: URL;
    try { url = new URL(link); } catch { throw new CrmProblem("Use full links starting with https://."); }
    if (url.protocol !== "https:" || url.username || url.password) throw new CrmProblem("Use full links starting with https://.");
    return url.href;
  });
}
const stale = () => new CrmProblem("Your profile changed. Reload before saving again.", 409);
export async function saveProfile(scope: string, person: string, body: Record<string, unknown>) {
  const name = text(body.name, "a display name", 100);
  const bio = text(body.bio, "a short bio", 500, false);
  const links = validLinks(body.links);
  const visibility = body.public as Record<string, unknown> | undefined;
  if (!visibility || ["name", "bio", "links", "photo"].some(k => typeof visibility[k] !== "boolean")) throw new CrmProblem("Choose which fields are public.");
  const shown = { name: visibility.name, bio: visibility.bio, links: visibility.links, photo: visibility.photo } as Profile["public"];
  const expected = body.revision;
  if (typeof expected !== "number" || !Number.isSafeInteger(expected)) throw stale();
  // Queue before saving: if queue storage fails, no unreviewed new text is committed.
  await checkNewText(scope, { kind: "person", ref: person }, `${name}\n${bio}`);
  if (isFake()) {
    let row = fakeProfile(scope, person);
    if ((row?.revision ?? 0) !== expected) throw stale();
    if (!row) fakeRows<FakeProfile>("crm_profile").push(row = { scope, ...emptyProfile(person) });
    Object.assign(row, { name, bio, links, public: shown, revision: row.revision + 1 });
    return fakeCopy(row);
  }
  const sql = crmDatabase();
  const linksJson = JSON.stringify(links);
  // The revision condition makes one of two concurrent saves of the same version win.
  const [row] = expected === 0
    ? await sql`insert into crm_profile as p (scope, person, revision, name, bio, links, public_name, public_bio, public_links, public_photo)
        values (${scope}, ${person}, 1, ${name}, ${bio}, ${linksJson}::text::jsonb, ${shown.name}, ${shown.bio}, ${shown.links}, ${shown.photo})
        on conflict (scope, person) do update set revision = p.revision + 1, name = excluded.name, bio = excluded.bio, links = excluded.links,
          public_name = excluded.public_name, public_bio = excluded.public_bio, public_links = excluded.public_links, public_photo = excluded.public_photo, updated_at = now()
        where p.revision = 0 returning *`
    : await sql`update crm_profile set revision = revision + 1, name = ${name}, bio = ${bio}, links = ${linksJson}::text::jsonb,
          public_name = ${shown.name}, public_bio = ${shown.bio}, public_links = ${shown.links}, public_photo = ${shown.photo}, updated_at = now()
        where scope = ${scope} and person = ${person} and revision = ${expected} returning *`;
  if (!row) throw stale();
  return fromRow(row);
}
const PHOTO_TYPES = ["image/png", "image/jpeg", "image/webp"];
export async function startProfilePhoto(scope: string, person: string, body: Record<string, unknown>) {
  if (!PHOTO_TYPES.includes(String(body.contentType)) || typeof body.sizeBytes !== "number" || body.sizeBytes > 5_000_000) throw new CrmProblem("Choose a PNG, JPEG or WebP photo under 5 MB.");
  const link = await startUpload(body);
  if (isFake()) {
    let row = fakeProfile(scope, person);
    if (!row) fakeRows<FakeProfile>("crm_profile").push(row = { scope, ...emptyProfile(person) });
    row.pendingPhoto = link.fileId; row.revision++;
  } else {
    await crmDatabase()`insert into crm_profile as p (scope, person, revision, pending_photo) values (${scope}, ${person}, 1, ${link.fileId})
      on conflict (scope, person) do update set pending_photo = excluded.pending_photo, revision = p.revision + 1, updated_at = now()`;
  }
  return link;
}
export async function finishProfilePhoto(scope: string, person: string, fileId: unknown) {
  const before = await findProfile(scope, person);
  if (typeof fileId !== "string" || before?.pendingPhoto !== fileId) throw new CrmProblem("Start a new photo upload.", 403);
  const photo = await finishUpload(fileId);
  // The size sent at start is the browser's claim; check the file that actually arrived.
  const problem = photo.kind !== "image" || !PHOTO_TYPES.includes(photo.contentType) ? "Choose a PNG, JPEG or WebP photo." : photo.sizeBytes > 5_000_000 ? "Choose a photo under 5 MB." : "";
  if (problem) { await discard(fileId); throw new CrmProblem(problem); }
  const newer = () => new CrmProblem("A newer photo upload has started. Try again.", 409);
  let saved: Profile;
  if (isFake()) {
    const row = fakeProfile(scope, person);
    if (row?.pendingPhoto !== fileId) throw newer();
    row.photo = photo; delete row.pendingPhoto; row.revision++;
    saved = fakeCopy(row);
  } else {
    const [row] = await crmDatabase()`update crm_profile set photo = ${JSON.stringify(photo)}::text::jsonb, pending_photo = null, revision = revision + 1, updated_at = now()
      where scope = ${scope} and person = ${person} and pending_photo = ${fileId} returning *`;
    if (!row) throw newer();
    saved = fromRow(row);
  }
  // A replaced photo's link stops working instead of staying live until it expires.
  if (before.photo && before.photo.fileId !== fileId) await discard(before.photo.fileId);
  return saved;
}
/** Best effort: an expired or already removed file is not an error. */
const discard = (fileId: string) => deleteUpload(fileId).catch(() => undefined);
