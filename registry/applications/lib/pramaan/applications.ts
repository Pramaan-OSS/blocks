import "server-only";
import { randomUUID } from "node:crypto";
import { crmDatabase, fakeRows, text, CrmProblem } from "@/lib/pramaan/crm-data";
import { limitPublic } from "@/lib/pramaan/public-guard";
import { isHidden } from "@/lib/pramaan/moderation";
import { blockedEitherWay, findListing, isUuid, listingRef } from "@/lib/pramaan/listings";
import { startUpload, finishUpload, deleteUpload, type StoredFile } from "@/lib/pramaan/upload";
import { notifyApplicant, type NoticeStatus } from "@/lib/pramaan/application-notice";

export type ApplicationStatus = "new" | "shortlisted" | "declined" | "accepted";
const STATUSES: ApplicationStatus[] = ["new", "shortlisted", "declined", "accepted"];
type Scoped<T> = T & { scope: string };
type Row = { scope: string; id: string; listingId: string; applicant: string; name: string; message: string; status: ApplicationStatus; revision: number; file?: StoredFile; pendingFile?: string; createdAt: string };
type Change = { applicationId: string; from?: ApplicationStatus; to: ApplicationStatus; actor: string; at: string };
type Note = { id: string; applicationId: string; requestId: string; author: string; body: string; notice: NoticeStatus; note: string; at: string };

export type FileView = { label: string; url?: string };
export type HistoryEntry = { status: ApplicationStatus; by: "you" | "the listing owner" | "the applicant"; at: string };
/** What the person who applied sees. A hidden or blocked listing loses its title and link. */
export type OwnApplication = { id: string; listing?: { id: string; title: string; open: boolean }; name: string; message: string; status: ApplicationStatus; appliedAt: string; file?: FileView; history: HistoryEntry[]; messages: { text: string; at: string }[] };
export type OwnApplications = { applications: OwnApplication[] };
/** What the listing's owner sees. `person` is for report and block only; never show it. */
export type Applicant = { id: string; revision: number; person: string; name: string; message: string; status: ApplicationStatus; appliedAt: string; file?: FileView; history: HistoryEntry[]; messages: { text: string; at: string; notice: NoticeStatus; note: string }[] };
export type ApplicantsData = { title: string; messagingOff: boolean; applicants: Applicant[] };

const MAX_ROWS = 200;
const HOUR_MS = 3_600_000;
const FILE_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp", "text/plain"];
const MAX_FILE_BYTES = 10_000_000;
const BAD_FILE = "Choose a PDF, image or text file under 10 MB.";
const isFake = () => process.env.PRAMAAN_FAKE === "1";
const fakeApplications = () => fakeRows<Row>("crm_application");
const fakeChanges = () => fakeRows<Scoped<Change>>("crm_application_event");
const fakeNotes = () => fakeRows<Scoped<Note>>("crm_application_message");
const iso = (value: Date | string) => new Date(value).toISOString();
const gone = () => new CrmProblem("This application is no longer available.", 404);
const unavailable = () => new CrmProblem("This listing isn't available.", 404);
const changed = () => new CrmProblem("This application changed since you opened it. Reload to see the latest.", 409);

function fromRow(row: Record<string, any>): Row {
  return {
    scope: row.scope, id: row.id, listingId: row.listing_id, applicant: row.applicant, name: row.name, message: row.message, status: row.status, revision: row.revision,
    ...(row.file ? { file: row.file } : {}), ...(row.pending_file ? { pendingFile: row.pending_file } : {}), createdAt: iso(row.created_at),
  };
}
function fileView(file?: StoredFile): FileView | undefined {
  if (!file) return undefined;
  const label = file.contentType === "application/pdf" ? "PDF" : file.kind === "image" ? "Image" : "Text file";
  return { label, ...(file.url && Date.parse(file.expiresAt) > Date.now() ? { url: file.url } : {}) };
}
async function findApplication(scope: string, id: string): Promise<Row | undefined> {
  if (isFake()) { const row = fakeApplications().find(a => a.scope === scope && a.id === id); return row && structuredClone(row); }
  const [row] = await crmDatabase()`select * from crm_application where scope = ${scope} and id = ${id}`;
  return row && fromRow(row);
}
async function historyAndNotes(scope: string, ids: string[]) {
  if (!ids.length) return { changes: [] as Change[], notes: [] as Note[] };
  if (isFake()) return { changes: fakeChanges().filter(c => c.scope === scope && ids.includes(c.applicationId)), notes: fakeNotes().filter(n => n.scope === scope && ids.includes(n.applicationId)) };
  const sql = crmDatabase();
  const changes = await sql`select * from crm_application_event where scope = ${scope} and application_id in ${sql(ids)} order by at, id`;
  const notes = await sql`select * from crm_application_message where scope = ${scope} and application_id in ${sql(ids)} order by created_at`;
  return {
    changes: changes.map(c => ({ applicationId: c.application_id, ...(c.from_status ? { from: c.from_status } : {}), to: c.to_status, actor: c.actor, at: iso(c.at) })) as Change[],
    notes: notes.map(n => ({ id: n.id, applicationId: n.application_id, requestId: n.request_id, author: n.author, body: n.body, notice: n.notice, note: n.note, at: iso(n.created_at) })) as Note[],
  };
}
const historyOf = (changes: Change[], id: string, viewer: string, other: HistoryEntry["by"]) =>
  changes.filter(c => c.applicationId === id).map(c => ({ status: c.to, by: c.actor === viewer ? "you" as const : other, at: c.at }));

/** The listing as this person may see it, or nothing when it is hidden or either of them blocked the other. */
async function shownListing(scope: string, listingId: string, viewer: string) {
  const listing = await findListing(scope, listingId);
  if (!listing || await isHidden(listingRef(listingId), scope) || await blockedEitherWay(viewer, listing.owner, scope)) return undefined;
  return listing;
}
export async function apply(scope: string, member: string, body: Record<string, unknown>) {
  if (!isUuid(body.listingId)) throw unavailable();
  const name = text(body.name, "your name", 100);
  const message = text(body.message, "a message", 4000);
  const listing = await shownListing(scope, body.listingId, member);
  if (!listing) throw unavailable();
  if (listing.owner === member) throw new CrmProblem("You can't apply to your own listing.");
  if (listing.status !== "open") throw new CrmProblem("This listing is closed.", 409);
  limitPublic("application", member, 20, HOUR_MS);
  const id = randomUUID();
  const twice = () => new CrmProblem("You already applied to this listing.", 409);
  if (isFake()) {
    if (fakeApplications().some(a => a.scope === scope && a.listingId === listing.id && a.applicant === member)) throw twice();
    const at = new Date().toISOString();
    fakeApplications().push({ scope, id, listingId: listing.id, applicant: member, name, message, status: "new", revision: 1, createdAt: at });
    fakeChanges().push({ scope, applicationId: id, to: "new", actor: member, at });
    return { id };
  }
  await crmDatabase().begin(async tx => {
    // Holding the listing row means a close cannot land between this check and the insert.
    const [held] = await tx`select status from crm_listing where scope = ${scope} and id = ${listing.id} for share`;
    if (held?.status !== "open") throw new CrmProblem("This listing is closed.", 409);
    const [row] = await tx`insert into crm_application (scope, id, listing_id, applicant, name, message) values (${scope}, ${id}, ${listing.id}, ${member}, ${name}, ${message})
      on conflict (scope, listing_id, applicant) do nothing returning created_at`;
    if (!row) throw twice();
    await tx`insert into crm_application_event (scope, application_id, to_status, actor, at) values (${scope}, ${id}, 'new', ${member}, ${row.created_at})`;
  });
  return { id };
}

type Joined = { row: Row; listing?: { id: string; title: string; open: boolean } };
async function ownRows(scope: string, member: string): Promise<Joined[]> {
  if (isFake()) {
    const rows = fakeApplications().filter(a => a.scope === scope && a.applicant === member).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, MAX_ROWS);
    return Promise.all(rows.map(async row => {
      const listing = await shownListing(scope, row.listingId, member);
      return { row: structuredClone(row), ...(listing ? { listing: { id: listing.id, title: listing.title, open: listing.status === "open" } } : {}) };
    }));
  }
  // ponytail: the newest 200 of one person's applications; add paging when someone keeps more.
  const rows = await crmDatabase()`select a.*, l.title, l.status as listing_status,
      exists (select 1 from crm_hidden_item h where h.scope = a.scope and h.ref = 'listing:' || l.id::text)
      or exists (select 1 from crm_block b where b.scope = a.scope and ((b.viewer = ${member} and b.other = l.owner) or (b.viewer = l.owner and b.other = ${member}))) as unavailable
    from crm_application a join crm_listing l on l.scope = a.scope and l.id = a.listing_id
    where a.scope = ${scope} and a.applicant = ${member} order by a.created_at desc limit ${MAX_ROWS}`;
  return rows.map(r => ({ row: fromRow(r), ...(r.unavailable ? {} : { listing: { id: r.listing_id, title: r.title, open: r.listing_status === "open" } }) }));
}
export async function ownApplications(scope: string, member: string): Promise<OwnApplications> {
  const joined = await ownRows(scope, member);
  const { changes, notes } = await historyAndNotes(scope, joined.map(j => j.row.id));
  return {
    applications: joined.map(({ row, listing }) => ({
      id: row.id, ...(listing ? { listing } : {}), name: row.name, message: row.message, status: row.status, appliedAt: row.createdAt, file: fileView(row.file),
      history: historyOf(changes, row.id, member, "the listing owner"),
      messages: listing ? notes.filter(n => n.applicationId === row.id).map(n => ({ text: n.body, at: n.at })) : [],
    })),
  };
}
/** Only the listing's owner, and never a person either of them blocked. */
export async function listingApplicants(scope: string, owner: string, listingId: string): Promise<ApplicantsData> {
  const listing = isUuid(listingId) ? await findListing(scope, listingId) : undefined;
  if (listing?.owner !== owner) throw unavailable();
  let rows: Row[];
  if (isFake()) {
    rows = [];
    for (const row of fakeApplications().filter(a => a.scope === scope && a.listingId === listingId)) if (!await blockedEitherWay(owner, row.applicant, scope)) rows.push(structuredClone(row));
    rows = rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, MAX_ROWS);
  } else {
    // ponytail: the newest 200 applicants; add paging and a status filter when a listing draws more.
    rows = (await crmDatabase()`select a.* from crm_application a where a.scope = ${scope} and a.listing_id = ${listingId}
      and not exists (select 1 from crm_block b where b.scope = a.scope and ((b.viewer = ${owner} and b.other = a.applicant) or (b.viewer = a.applicant and b.other = ${owner})))
      order by a.created_at desc limit ${MAX_ROWS}`).map(fromRow);
  }
  const { changes, notes } = await historyAndNotes(scope, rows.map(r => r.id));
  return {
    title: listing.title, messagingOff: await isHidden(listingRef(listingId), scope),
    applicants: rows.map(row => ({
      id: row.id, revision: row.revision, person: row.applicant, name: row.name, message: row.message, status: row.status, appliedAt: row.createdAt, file: fileView(row.file),
      history: historyOf(changes, row.id, owner, "the applicant"),
      messages: notes.filter(n => n.applicationId === row.id).map(n => ({ text: n.body, at: n.at, notice: n.notice, note: n.note })),
    })),
  };
}
async function ownersApplication(scope: string, owner: string, id: unknown) {
  const row = isUuid(id) ? await findApplication(scope, id) : undefined;
  const listing = row && await findListing(scope, row.listingId);
  if (!row || listing?.owner !== owner || await blockedEitherWay(owner, row.applicant, scope)) throw gone();
  return { row, listing };
}
export async function moveApplication(scope: string, owner: string, body: Record<string, unknown>) {
  const to = body.status as ApplicationStatus;
  if (!STATUSES.includes(to)) throw new CrmProblem("Choose a status.");
  const { row } = await ownersApplication(scope, owner, body.id);
  if (body.revision !== row.revision) throw changed();
  if (row.status === to) return { id: row.id };
  if (isFake()) {
    const at = new Date().toISOString();
    Object.assign(fakeApplications().find(a => a.scope === scope && a.id === row.id)!, { status: to, revision: row.revision + 1 });
    fakeChanges().push({ scope, applicationId: row.id, from: row.status, to, actor: owner, at });
    return { id: row.id };
  }
  await crmDatabase().begin(async tx => {
    // The revision condition makes one of two concurrent moves win, and the change and its record land together.
    const [saved] = await tx`update crm_application set status = ${to}, revision = revision + 1, updated_at = now()
      where scope = ${scope} and id = ${row.id} and revision = ${row.revision} returning updated_at`;
    if (!saved) throw changed();
    await tx`insert into crm_application_event (scope, application_id, from_status, to_status, actor, at) values (${scope}, ${row.id}, ${row.status}, ${to}, ${owner}, ${saved.updated_at})`;
  });
  return { id: row.id };
}
export async function messageApplicant(scope: string, owner: string, body: Record<string, unknown>) {
  const { row, listing } = await ownersApplication(scope, owner, body.id);
  if (!isUuid(body.requestId)) throw new CrmProblem("Please reload the page and try again.");
  const message = text(body.text, "a message", 2000);
  if (await isHidden(listingRef(listing.id), scope)) throw new CrmProblem("This listing is hidden, so messages are off.", 409);
  limitPublic("application-message", owner, 20, HOUR_MS);
  const id = randomUUID();
  // The claim comes first: a repeat of the same draft finds it and sends nothing.
  let claimed: boolean;
  if (isFake()) {
    claimed = !fakeNotes().some(n => n.scope === scope && n.applicationId === row.id && n.requestId === body.requestId);
    if (claimed) fakeNotes().push({ scope, id, applicationId: row.id, requestId: body.requestId, author: owner, body: message, notice: "pending", note: "", at: new Date().toISOString() });
  } else {
    claimed = (await crmDatabase()`insert into crm_application_message (scope, id, application_id, request_id, author, body) values (${scope}, ${id}, ${row.id}, ${body.requestId}, ${owner}, ${message})
      on conflict (scope, application_id, request_id) do nothing returning id`).length > 0;
  }
  if (!claimed) {
    const [held] = isFake()
      ? fakeNotes().filter(n => n.scope === scope && n.applicationId === row.id && n.requestId === body.requestId)
      : await crmDatabase()`select notice, note from crm_application_message where scope = ${scope} and application_id = ${row.id} and request_id = ${body.requestId}`;
    return { notice: held.notice as NoticeStatus, note: held.note as string };
  }
  const { status, note } = await notifyApplicant({ scope, person: row.applicant, event: id, listingTitle: listing.title });
  if (isFake()) Object.assign(fakeNotes().find(n => n.id === id)!, { notice: status, note });
  else await crmDatabase()`update crm_application_message set notice = ${status}, note = ${note} where scope = ${scope} and id = ${id}`;
  return { notice: status, note };
}

const discard = (fileId: string) => deleteUpload(fileId).catch(() => undefined);
async function ownApplication(scope: string, member: string, id: unknown) {
  const row = isUuid(id) ? await findApplication(scope, id) : undefined;
  if (row?.applicant !== member) throw gone();
  return row;
}
export async function startApplicationFile(scope: string, member: string, body: Record<string, unknown>) {
  const row = await ownApplication(scope, member, body.id);
  if (row.file) throw new CrmProblem("This application already has a file.", 409);
  if (!FILE_TYPES.includes(String(body.contentType)) || typeof body.sizeBytes !== "number" || body.sizeBytes > MAX_FILE_BYTES) throw new CrmProblem(BAD_FILE);
  limitPublic("application-file", member, 30, HOUR_MS);
  const link = await startUpload(body);
  if (isFake()) fakeApplications().find(a => a.scope === scope && a.id === row.id)!.pendingFile = link.fileId;
  else await crmDatabase()`update crm_application set pending_file = ${link.fileId}, updated_at = now() where scope = ${scope} and id = ${row.id}`;
  return link;
}
export async function finishApplicationFile(scope: string, member: string, body: Record<string, unknown>) {
  const row = await ownApplication(scope, member, body.id);
  if (typeof body.fileId !== "string" || row.pendingFile !== body.fileId) throw new CrmProblem("Start a new file upload.", 403);
  const file = await finishUpload(body.fileId);
  // The size sent at start is the browser's claim; check the file that actually arrived.
  if (!FILE_TYPES.includes(file.contentType) || file.sizeBytes > MAX_FILE_BYTES) { await discard(body.fileId); throw new CrmProblem(BAD_FILE); }
  if (isFake()) {
    const stored = fakeApplications().find(a => a.scope === scope && a.id === row.id)!;
    stored.file = file; delete stored.pendingFile;
    return { id: row.id };
  }
  const [saved] = await crmDatabase()`update crm_application set file = ${JSON.stringify(file)}::text::jsonb, pending_file = null, updated_at = now()
    where scope = ${scope} and id = ${row.id} and pending_file = ${body.fileId} and file is null returning id`;
  if (!saved) { await discard(body.fileId); throw new CrmProblem("This application already has a file.", 409); }
  return { id: row.id };
}
