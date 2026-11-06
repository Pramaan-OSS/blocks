import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeCrmDatabase } from "@/lib/pramaan/crm-data";
import { resetPublicLimits } from "@/lib/pramaan/public-guard";
import * as context from "@/lib/pramaan/social-context";
import * as files from "@/lib/pramaan/upload";
import * as server from "@/lib/pramaan/server";
import { moderate, moderationQueue } from "@/lib/pramaan/moderation";
import { closeListing, finishListingPhoto, listingPage, ownListings, saveListing, searchListings, startListingPhoto, PAGE_SIZE } from "@/lib/pramaan/listings";
import { apply, finishApplicationFile, listingApplicants, messageApplicant, moveApplication, ownApplications, startApplicationFile } from "@/lib/pramaan/applications";
const url = process.env.TEST_DATABASE_URL;
const listing = (extra = {}) => ({ title: "Garden help", description: "Weekly lawn care", category: "Services", priceText: "$25 an hour", price: 25, location: "Pune", ...extra });
const form = { name: "Sam", message: "I can help" };
const later = new Date(Date.now() + 86_400_000).toISOString();
const stored = (fileId: string): files.StoredFile => ({ fileId, kind: "image", contentType: "image/png", sizeBytes: 10, createdAt: later, expiresAt: later, url: `https://files.test/${fileId}` });
describe.skipIf(!url)("B2 real Postgres", () => {
  const scope = `b2-${randomUUID()}`;
  let db: ReturnType<typeof postgres>;
  const params = (query = "") => new URLSearchParams(query);
  beforeAll(async () => {
    vi.stubEnv("PRAMAAN_FAKE", "0"); vi.stubEnv("PRAMAAN_TEXT_SCREENING", ""); vi.stubEnv("DATABASE_URL", url!);
    vi.spyOn(context, "mayModerate").mockImplementation(async member => member === "owner");
    db = postgres(url!, { max: 5, prepare: false });
    // Apply every numbered migration in order, twice, as an installed host would.
    for (const block of ["moderation", "listings", "applications"]) {
      const dir = `registry/${block}/src/db/migrations`;
      for (const file of (await readdir(dir)).sort()) {
        const sql = await readFile(`${dir}/${file}`, "utf8");
        await db.unsafe(sql); await db.unsafe(sql);
      }
    }
  });
  beforeEach(async () => {
    vi.stubEnv("PRAMAAN_FAKE", "0"); vi.stubEnv("DATABASE_URL", url!); resetPublicLimits();
    for (const table of ["crm_application_message", "crm_application_event", "crm_application", "crm_listing", "crm_moderation_audit", "crm_report", "crm_block", "crm_hidden_item"]) await db.unsafe(`delete from ${table} where scope = $1`, [scope]);
  });
  afterAll(async () => {
    try { for (const table of ["crm_application_message", "crm_application_event", "crm_application", "crm_listing", "crm_moderation_audit", "crm_report", "crm_block", "crm_hidden_item"]) await db.unsafe(`delete from ${table} where scope = $1`, [scope]); }
    finally { await closeCrmDatabase(); await db?.end(); vi.restoreAllMocks(); vi.unstubAllEnvs(); }
  });
  it("stores the reported title and description on the report, so an edit doesn't change them", async () => {
    const { id } = await saveListing(scope, "poster", listing({ title: "Original title", description: "Original words" }));
    await moderate(scope, "reporter", { action: "report", kind: "item", ref: `listing:${id}`, reason: "Spam" });
    await saveListing(scope, "poster", { ...listing({ title: "New title", description: "New words" }), id, revision: 1 });
    const [row] = await db`select subject from crm_report where scope = ${scope} and ref = ${`listing:${id}`}`;
    expect(row.subject).toEqual({ label: "Listing: Original title", excerpt: "Original words" });
    expect((await moderationQueue(scope)).reports.find(r => r.status === "open")?.subject?.label).toBe("Listing: Original title");
  });
  it("searches by text, category, location and price, and treats filter text as data", async () => {
    const { id } = await saveListing(scope, "a", listing({ title: "Plumber wanted", description: "Fix leaking pipes", category: "Jobs", location: "Mumbai", price: 100 }));
    await saveListing(scope, "b", listing({ title: "Old sofa", description: "Barely used", category: "For sale", location: "100% Pune_East", price: 40.5 }));
    await saveListing(scope, "c", listing({ title: "Free advice", description: "Ask me", location: "Pune", price: undefined, priceText: "Free" }));
    const titles = async (query: string) => (await searchListings(scope, params(query))).results.map(r => r.title).sort();
    expect(await titles("q=pipe")).toEqual(["Plumber wanted"]);
    expect(await titles("q=plumbers")).toEqual(["Plumber wanted"]);
    expect(await titles("q=sofa+barely")).toEqual(["Old sofa"]);
    expect(await titles(`q=${encodeURIComponent("' or 1=1 --")}`)).toEqual([]);
    expect(await titles(`q=${encodeURIComponent('"unclosed & | !')}`)).toEqual([]);
    expect(await titles("category=Jobs")).toEqual(["Plumber wanted"]);
    expect(await titles("location=pune")).toEqual(["Free advice", "Old sofa"]);
    expect(await titles(`location=${encodeURIComponent("100%")}`)).toEqual(["Old sofa"]);
    expect(await titles("location=%25")).toEqual(["Old sofa"]);
    expect(await titles("location=_")).toEqual(["Old sofa"]);
    expect(await titles("min=50")).toEqual(["Plumber wanted"]);
    expect(await titles("max=40.5")).toEqual(["Old sofa"]);
    expect((await listingPage(scope, id)).price).toBe("$25 an hour");
  });
  it("keeps pages full and counts honest around hidden and blocked rows", async () => {
    const hiddenIds: string[] = [];
    for (let i = 0; i < PAGE_SIZE + 5; i++) { resetPublicLimits(); const { id } = await saveListing(scope, i % 5 === 0 ? "spammer" : "poster", listing({ title: `Item ${i}` })); if (i % 5 === 1) hiddenIds.push(id); }
    await moderate(scope, "viewer", { action: "block", ref: "spammer" });
    for (const id of hiddenIds) {
      await moderate(scope, "reporter", { action: "report", kind: "item", ref: `listing:${id}`, reason: "Spam" });
      const open = (await moderationQueue(scope)).reports.find(r => r.status === "open")!;
      await moderate(scope, "owner", { action: "hide", id: open.id });
    }
    const total = PAGE_SIZE + 5 - hiddenIds.length;
    expect((await searchListings(scope, params())).total).toBe(total);
    const seen = await searchListings(scope, params(), "viewer");
    expect(seen.total).toBe(total - 5);
    expect(seen.results).toHaveLength(total - 5);
    expect(seen.results.some(r => hiddenIds.includes(r.id))).toBe(false);
    await expect(listingPage(scope, hiddenIds[0], "viewer")).rejects.toMatchObject({ status: 404 });
    expect((await listingPage(scope, hiddenIds[0], "poster")).hidden).toBe(true);
    expect((await ownListings(scope, "poster")).listings.filter(l => l.hidden)).toHaveLength(hiddenIds.length);
  });
  it("shows reviewers the listing, keeps the queue working on a made-up reference", async () => {
    const { id } = await saveListing(scope, "poster", listing());
    await moderate(scope, "reporter", { action: "report", kind: "item", ref: `listing:${id}`, reason: "Spam" });
    await moderate(scope, "reporter", { action: "report", kind: "item", ref: "listing:not-real", reason: "Spam" });
    await moderate(scope, "reporter", { action: "report", kind: "item", ref: `listing:${randomUUID()}`, reason: "Spam" });
    const labels = (await moderationQueue(scope)).reports.map(r => r.subject?.label).sort();
    expect(labels).toEqual(["Listing: Garden help", "Reported item", "Reported item"]);
  });
  it("stores a looked-up place and filters on it, and clears it when the location changes", async () => {
    vi.stubEnv("PRAMAAN_LISTING_GEOCODE", "1");
    const call = vi.spyOn(server, "capability").mockResolvedValue({ displayName: "Pune, Maharashtra, India", latitude: 18.5, longitude: 73.8 });
    const { id } = await saveListing(scope, "poster", listing());
    expect((await searchListings(scope, params("location=maharashtra"))).total).toBe(1);
    const [row] = await db`select place, latitude, longitude from crm_listing where id = ${id}`;
    expect(row).toEqual({ place: "Pune, Maharashtra, India", latitude: 18.5, longitude: 73.8 });
    call.mockRejectedValueOnce(new Error("down"));
    await saveListing(scope, "poster", listing({ id, revision: 1, location: "Delhi" }));
    expect((await searchListings(scope, params("location=maharashtra"))).total).toBe(0);
    expect((await db`select place from crm_listing where id = ${id}`)[0].place).toBeNull();
    call.mockRestore(); vi.stubEnv("PRAMAAN_LISTING_GEOCODE", "");
  });
  it("pages without overlap and keeps communities apart", async () => {
    for (let i = 0; i < PAGE_SIZE + 3; i++) { resetPublicLimits(); await saveListing(scope, "poster", listing({ title: `Item ${i}` })); }
    const other = `${scope}-other`;
    const { id } = await saveListing(other, "poster", listing());
    try {
      const first = await searchListings(scope, params()), second = await searchListings(scope, params("page=2"));
      expect([first.pages, first.results.length, second.results.length]).toEqual([2, PAGE_SIZE, 3]);
      expect(new Set([...first.results, ...second.results].map(r => r.id)).size).toBe(PAGE_SIZE + 3);
      await expect(listingPage(scope, id)).rejects.toMatchObject({ status: 404 });
    } finally { await db`delete from crm_listing where scope = ${other}`; }
  });
  it("lets one of two concurrent edits win, and photos land in the row", async () => {
    const { id } = await saveListing(scope, "poster", listing());
    const edits = await Promise.allSettled([saveListing(scope, "poster", listing({ id, revision: 1, title: "One" })), saveListing(scope, "poster", listing({ id, revision: 1, title: "Two" }))]);
    expect(edits.filter(e => e.status === "fulfilled")).toHaveLength(1);
    vi.spyOn(files, "startUpload").mockResolvedValue({ fileId: "file_1", uploadUrl: "https://u", headers: {} });
    vi.spyOn(files, "finishUpload").mockResolvedValue(stored("file_1"));
    await startListingPhoto(scope, "poster", { id, contentType: "image/png", sizeBytes: 10 });
    await finishListingPhoto(scope, "poster", { id, fileId: "file_1" });
    expect((await listingPage(scope, id)).photoUrls).toEqual(["https://files.test/file_1"]);
    await expect(finishListingPhoto(scope, "poster", { id, fileId: "file_1" })).rejects.toMatchObject({ status: 403 });
    vi.restoreAllMocks();
    vi.spyOn(context, "mayModerate").mockImplementation(async member => member === "owner");
  });
  it("takes one application per person even under a race, and none after closing", async () => {
    const { id: listingId } = await saveListing(scope, "poster", listing());
    const tries = await Promise.allSettled(Array.from({ length: 5 }, () => apply(scope, "sam", { listingId, ...form })));
    expect(tries.filter(t => t.status === "fulfilled")).toHaveLength(1);
    expect(tries.filter(t => t.status === "rejected").map(t => (t as PromiseRejectedResult).reason.status)).toEqual([409, 409, 409, 409]);
    expect((await db`select count(*)::int as n from crm_application_event where scope = ${scope}`)[0].n).toBe(1);
    await closeListing(scope, "poster", listingId);
    await expect(apply(scope, "kim", { listingId, ...form })).rejects.toThrow("closed");
  });
  it("lets one of two concurrent moves win and records who and when with it", async () => {
    const { id: listingId } = await saveListing(scope, "poster", listing());
    const { id } = await apply(scope, "sam", { listingId, ...form });
    const moves = await Promise.allSettled([moveApplication(scope, "poster", { id, revision: 1, status: "accepted" }), moveApplication(scope, "poster", { id, revision: 1, status: "declined" })]);
    expect(moves.filter(m => m.status === "fulfilled")).toHaveLength(1);
    const events = await db`select from_status, to_status, actor, at from crm_application_event where scope = ${scope} and application_id = ${id} order by id`;
    expect(events.map(e => [e.from_status, e.actor])).toEqual([[null, "sam"], ["new", "poster"]]);
    const [row] = await db`select status, updated_at from crm_application where id = ${id}`;
    expect(events[1].to_status).toBe(row.status);
    expect(events[1].at.toISOString()).toBe(row.updated_at.toISOString());
    await expect(moveApplication(scope, "stranger", { id, revision: 2, status: "new" })).rejects.toMatchObject({ status: 404 });
    const [own] = (await ownApplications(scope, "sam")).applications;
    expect(own.history).toHaveLength(2);
    expect(own.listing).toMatchObject({ id: listingId, open: true });
  });
  it("claims a message once under a race, stores no address and records the outcome", async () => {
    const { id: listingId } = await saveListing(scope, "poster", listing());
    const { id } = await apply(scope, "sam", { listingId, ...form });
    const requestId = randomUUID();
    const results = await Promise.all(Array.from({ length: 4 }, () => messageApplicant(scope, "poster", { id, requestId, text: "Hello" })));
    expect(results.every(r => r.notice === "not-sent" || r.notice === "pending")).toBe(true);
    const rows = await db`select * from crm_application_message where scope = ${scope}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ author: "poster", notice: "not-sent" });
    expect(JSON.stringify(rows[0])).not.toContain("@");
    expect((await listingApplicants(scope, "poster", listingId)).applicants[0].messages[0]).toMatchObject({ text: "Hello", notice: "not-sent" });
  });
  it("filters blocked applicants in the query, hides titles, and stores one file", async () => {
    const { id: listingId } = await saveListing(scope, "poster", listing());
    const { id } = await apply(scope, "sam", { listingId, ...form });
    await apply(scope, "kim", { listingId, ...form, name: "Kim" });
    await moderate(scope, "poster", { action: "block", ref: "kim" });
    expect((await listingApplicants(scope, "poster", listingId)).applicants.map(a => a.name)).toEqual(["Sam"]);
    expect((await ownApplications(scope, "kim")).applications[0].listing).toBeUndefined();
    vi.spyOn(files, "startUpload").mockResolvedValue({ fileId: "file_2", uploadUrl: "https://u", headers: {} });
    vi.spyOn(files, "finishUpload").mockResolvedValue(stored("file_2"));
    await startApplicationFile(scope, "sam", { id, contentType: "image/png", sizeBytes: 10 });
    await finishApplicationFile(scope, "sam", { id, fileId: "file_2" });
    expect((await listingApplicants(scope, "poster", listingId)).applicants[0].file).toEqual({ label: "Image", url: "https://files.test/file_2" });
    vi.restoreAllMocks();
    vi.spyOn(context, "mayModerate").mockImplementation(async member => member === "owner");
  });
  it("refuses an application to a listing in another community at the database", async () => {
    await expect(db`insert into crm_application (scope, id, listing_id, applicant, name, message) values (${scope}, ${randomUUID()}, ${randomUUID()}, 'sam', 'Sam', 'Hi')`).rejects.toThrow();
  });
});
