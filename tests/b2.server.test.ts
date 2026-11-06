import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeRows, resetCrmFake } from "@/lib/pramaan/crm-data";
import { resetFake } from "@/lib/pramaan/fake";
import { resetPublicLimits } from "@/lib/pramaan/public-guard";
import { moderate, moderationQueue } from "@/lib/pramaan/moderation";
import { closeListing, finishListingPhoto, listingPage, ownListings, removeListingPhoto, saveListing, searchListings, startListingPhoto, PAGE_SIZE } from "@/lib/pramaan/listings";
import { apply, finishApplicationFile, listingApplicants, messageApplicant, moveApplication, ownApplications, startApplicationFile } from "@/lib/pramaan/applications";
import { GET as listingsGet, POST as listingsPost } from "@/registry/listings/app/api/pramaan/listings/route";
import { GET as applicationsGet, POST as applicationsPost } from "@/registry/applications/app/api/pramaan/applications/route";
import * as server from "@/lib/pramaan/server";
import * as files from "@/lib/pramaan/upload";
const scope = "demo";
const later = new Date(Date.now() + 86_400_000).toISOString();
const stored = (extra: Partial<files.StoredFile> = {}): files.StoredFile => ({ fileId: "file_1", kind: "image", contentType: "image/png", sizeBytes: 10, createdAt: later, expiresAt: later, url: "https://files.test/one", ...extra });
const listing = (extra = {}) => ({ title: "Garden help", description: "Weekly lawn care", category: "Services", priceText: "$25 an hour", price: 25, location: "Pune", ...extra });
const params = (query = "") => new URLSearchParams(query);
const uuid = "00000000-0000-4000-8000-000000000000";
const route = (url: string, body?: unknown, member = "mbr_owner", origin?: string) => new Request(`http://app.test${url}`, { method: body ? "POST" : "GET", headers: { cookie: `pramaan_member=${member}`, ...(body ? { "Content-Type": "application/json" } : {}), ...(origin ? { origin } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
const hide = async (id: string) => {
  await moderate(scope, "reporter", { action: "report", kind: "item", ref: `listing:${id}`, reason: "Spam" });
  await moderate(scope, "mbr_owner", { action: "hide", id: (await moderationQueue(scope)).reports[0].id });
};
beforeEach(() => { resetCrmFake(); resetFake(); vi.stubEnv("PRAMAAN_TEXT_SCREENING", ""); vi.stubEnv("PRAMAAN_SOCIAL_SCOPE", "demo"); vi.stubEnv("PRAMAAN_LISTING_GEOCODE", ""); vi.stubEnv("PRAMAAN_NOTICE_TRANSPORT", ""); vi.stubEnv("PRAMAAN_NOTICE_FROM", ""); });
afterEach(() => { vi.restoreAllMocks(); });

describe("listings", () => {
  it("posts, edits and closes, and only the owner can change a listing", async () => {
    const { id } = await saveListing(scope, "poster", listing());
    expect((await searchListings(scope, params())).results).toMatchObject([{ id, title: "Garden help", price: "$25 an hour", location: "Pune" }]);
    await expect(saveListing(scope, "stranger", listing({ id, revision: 1 }))).rejects.toMatchObject({ status: 404 });
    await expect(closeListing(scope, "stranger", id)).rejects.toMatchObject({ status: 404 });
    await saveListing(scope, "poster", listing({ id, revision: 1, title: "Lawn help" }));
    await expect(saveListing(scope, "poster", listing({ id, revision: 1, title: "Stale" }))).rejects.toMatchObject({ status: 409 });
    expect((await listingPage(scope, id)).title).toBe("Lawn help");
    await closeListing(scope, "poster", id);
    expect((await searchListings(scope, params())).total).toBe(0);
    expect((await listingPage(scope, id)).status).toBe("closed");
    await expect(saveListing(scope, "poster", listing({ id, revision: 3 }))).rejects.toMatchObject({ status: 409 });
    await expect(startListingPhoto(scope, "poster", { id, contentType: "image/png", sizeBytes: 10 })).rejects.toThrow("closed");
  });
  it("validates every field and refuses a category outside the list", async () => {
    await expect(saveListing(scope, "poster", listing({ title: " " }))).rejects.toThrow("Enter a title");
    await expect(saveListing(scope, "poster", listing({ category: "Other" }))).rejects.toThrow("category");
    await expect(saveListing(scope, "poster", listing({ price: -1 }))).rejects.toThrow("number");
    await expect(saveListing(scope, "poster", listing({ price: "abc" }))).rejects.toThrow("number");
    await expect(saveListing(scope, "poster", listing({ id: "not-an-id", revision: 1 }))).rejects.toMatchObject({ status: 404 });
    await expect(searchListings(scope, params("category=Other"))).rejects.toThrow("category");
    await expect(searchListings(scope, params("min=9&max=1"))).rejects.toThrow("lowest");
  });
  it("filters by text, category, location and price range", async () => {
    await saveListing(scope, "a", listing({ title: "Plumber wanted", description: "Fix pipes", category: "Jobs", location: "Mumbai", price: 100 }));
    await saveListing(scope, "b", listing({ title: "Old sofa", description: "Barely used", category: "For sale", location: "Pune", price: 40 }));
    await saveListing(scope, "c", listing({ title: "Free advice", description: "Ask me", category: "Services", location: "Pune East", price: undefined, priceText: "Free" }));
    const titles = async (query: string) => (await searchListings(scope, params(query))).results.map(r => r.title).sort();
    expect(await titles("q=PLUMBER")).toEqual(["Plumber wanted"]);
    expect(await titles("q=barely+sofa")).toEqual(["Old sofa"]);
    expect(await titles("category=Jobs")).toEqual(["Plumber wanted"]);
    expect(await titles("location=pune")).toEqual(["Free advice", "Old sofa"]);
    expect(await titles("min=50")).toEqual(["Plumber wanted"]);
    expect(await titles("max=50")).toEqual(["Old sofa"]);
    expect(await titles("min=40&max=100")).toEqual(["Old sofa", "Plumber wanted"]);
    expect(await titles("location=pune&category=Services")).toEqual(["Free advice"]);
  });
  it("pages results, and a bad page number falls back to the first", async () => {
    for (let i = 0; i < PAGE_SIZE + 2; i++) { resetPublicLimits(); await saveListing(scope, "poster", listing({ title: `Item ${i}` })); }
    const first = await searchListings(scope, params());
    expect(first).toMatchObject({ page: 1, pages: 2, total: PAGE_SIZE + 2 });
    expect(first.results).toHaveLength(PAGE_SIZE);
    const second = await searchListings(scope, params("page=2"));
    expect(second.results).toHaveLength(2);
    expect(new Set([...first.results, ...second.results].map(r => r.id)).size).toBe(PAGE_SIZE + 2);
    expect((await searchListings(scope, params("page=-3"))).page).toBe(1);
    expect((await searchListings(scope, params("page=9999"))).page).toBe(1);
    expect((await searchListings(scope, params("page=3"))).results).toHaveLength(PAGE_SIZE);
  });
  it("never shows a hidden listing, in search, count or page, but tells its owner", async () => {
    const { id } = await saveListing(scope, "poster", listing());
    await saveListing(scope, "other", listing({ title: "Still here" }));
    await hide(id);
    const found = await searchListings(scope, params());
    expect(found.total).toBe(1);
    expect(found.results.map(r => r.title)).toEqual(["Still here"]);
    await expect(listingPage(scope, id)).rejects.toMatchObject({ status: 404 });
    await expect(listingPage(scope, id, "stranger")).rejects.toMatchObject({ status: 404 });
    expect((await listingPage(scope, id, "poster")).hidden).toBe(true);
    expect((await ownListings(scope, "poster")).listings[0].hidden).toBe(true);
  });
  it("keeps the reported title and description after the listing changes, and ignores words from the browser", async () => {
    const { id } = await saveListing(scope, "poster", listing());
    await moderate(scope, "reporter", { action: "report", kind: "item", ref: `listing:${id}`, reason: "Spam", subject: { label: "Forged", excerpt: "Forged" } });
    await saveListing(scope, "poster", { ...listing({ title: "Something else", description: "Nothing to see" }), id, revision: 1 });
    await closeListing(scope, "poster", id);
    expect((await moderationQueue(scope)).reports[0].subject).toEqual({ label: "Listing: Garden help", excerpt: "Weekly lawn care" });
  });
  it("shows reviewers a new listing the automatic check flagged, and the newest words after an edit", async () => {
    vi.stubEnv("PRAMAAN_TEXT_SCREENING", "1");
    const call = vi.spyOn(server, "capability").mockResolvedValue({ primaryCategory: "spam", confidence: 0.95 });
    try {
      const { id } = await saveListing(scope, "poster", listing());
      expect((await moderationQueue(scope)).reports[0]).toMatchObject({ automatic: true, subject: { label: "Listing: Garden help", excerpt: "Weekly lawn care" } });
      await saveListing(scope, "poster", { ...listing({ description: "Buy now" }), id, revision: 1 });
      const { reports } = await moderationQueue(scope);
      expect(reports).toHaveLength(1);
      expect(reports[0].subject?.excerpt).toBe("Buy now");
    } finally { call.mockRestore(); }
  });
  it("shows reviewers which listing a report is about, and copes with a made-up reference", async () => {
    const { id } = await saveListing(scope, "poster", listing());
    await moderate(scope, "reporter", { action: "report", kind: "item", ref: `listing:${id}`, reason: "Spam" });
    await moderate(scope, "reporter", { action: "report", kind: "item", ref: "listing:not-real", reason: "Spam" });
    const subjects = (await moderationQueue(scope)).reports.map(r => r.subject);
    expect(subjects).toContainEqual({ label: "Listing: Garden help", excerpt: "Weekly lawn care" });
    expect(subjects).toContainEqual({ label: "Reported item" });
  });
  it("keeps blocked people apart in both directions", async () => {
    const { id } = await saveListing(scope, "poster", listing());
    await moderate(scope, "viewer", { action: "block", ref: "poster" });
    expect((await searchListings(scope, params(), "viewer")).total).toBe(0);
    await expect(listingPage(scope, id, "viewer")).rejects.toMatchObject({ status: 404 });
    await moderate(scope, "poster", { action: "block", ref: "blocked" });
    expect((await searchListings(scope, params(), "blocked")).total).toBe(0);
    await expect(listingPage(scope, id, "blocked")).rejects.toMatchObject({ status: 404 });
    expect((await searchListings(scope, params(), "anyone")).total).toBe(1);
    expect((await searchListings(scope, params())).total).toBe(1);
  });
  it("tells the public nothing about who posted", async () => {
    const { id } = await saveListing(scope, "mbr_poster", listing());
    const search = await (await listingsGet(route("/api/pramaan/listings", undefined, "none"))).text();
    const page = await (await listingsGet(route(`/api/pramaan/listings?id=${id}`, undefined, "none"))).text();
    expect(search + page).not.toContain("mbr_poster");
    expect(JSON.parse(page)).toMatchObject({ signedIn: false, mine: false });
    expect((await listingPage(scope, id, "viewer")).poster).toBe("mbr_poster");
    expect((await listingPage(scope, id, "mbr_poster")).poster).toBeUndefined();
  });
  it("refuses signed-out writes, other origins, unknown actions and floods", async () => {
    const save = { action: "save", ...listing() };
    expect((await listingsPost(route("/api/pramaan/listings", save, "none"))).status).toBe(401);
    expect((await listingsPost(route("/api/pramaan/listings", save, "mbr_owner", "https://other.test"))).status).toBe(403);
    expect((await listingsPost(route("/api/pramaan/listings", { action: "delete-all" }))).status).toBe(400);
    expect((await listingsGet(route("/api/pramaan/listings?mine=1", undefined, "none"))).status).toBe(401);
    let response = new Response();
    for (let i = 0; i < 601; i++) response = await listingsGet(route("/api/pramaan/listings"));
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: { message: "Too many requests. Please try again later." } });
    for (let i = 0; i < 20; i++) await saveListing(scope, "spammer", listing());
    await expect(saveListing(scope, "spammer", listing())).rejects.toMatchObject({ status: 429 });
  });
  it("keeps a form of up to six photos under the write limit", async () => {
    let response = new Response();
    for (let i = 0; i < 14; i++) response = await listingsPost(route("/api/pramaan/listings", { action: "save", ...listing() }));
    expect(response.status).toBe(200);
  });
  it("attaches only the file this owner started, of an allowed type, up to six", async () => {
    const { id } = await saveListing(scope, "poster", listing());
    const start = vi.spyOn(files, "startUpload").mockResolvedValue({ fileId: "file_1", uploadUrl: "https://u", headers: {} });
    const finish = vi.spyOn(files, "finishUpload").mockResolvedValue(stored());
    const remove = vi.spyOn(files, "deleteUpload").mockResolvedValue({ deleted: true });
    await expect(startListingPhoto(scope, "poster", { id, contentType: "image/svg+xml", sizeBytes: 10 })).rejects.toThrow("PNG");
    await expect(startListingPhoto(scope, "poster", { id, contentType: "image/png", sizeBytes: 5_000_001 })).rejects.toThrow("PNG");
    await expect(startListingPhoto(scope, "stranger", { id, contentType: "image/png", sizeBytes: 10 })).rejects.toMatchObject({ status: 404 });
    expect(start).not.toHaveBeenCalled();
    await startListingPhoto(scope, "poster", { id, contentType: "image/png", sizeBytes: 10 });
    await expect(finishListingPhoto(scope, "poster", { id, fileId: "file_other" })).rejects.toMatchObject({ status: 403 });
    expect(finish).not.toHaveBeenCalled();
    finish.mockResolvedValueOnce(stored({ contentType: "image/gif" }));
    await expect(finishListingPhoto(scope, "poster", { id, fileId: "file_1" })).rejects.toThrow("PNG");
    expect(remove).toHaveBeenCalledWith("file_1");
    await finishListingPhoto(scope, "poster", { id, fileId: "file_1" });
    expect((await listingPage(scope, id)).photoUrls).toEqual(["https://files.test/one"]);
    expect((await searchListings(scope, params())).results[0].photoUrl).toBe("https://files.test/one");
    for (let i = 2; i <= 6; i++) { start.mockResolvedValueOnce({ fileId: `file_${i}`, uploadUrl: "https://u", headers: {} }); finish.mockResolvedValueOnce(stored({ fileId: `file_${i}` })); await startListingPhoto(scope, "poster", { id, contentType: "image/png", sizeBytes: 10 }); await finishListingPhoto(scope, "poster", { id, fileId: `file_${i}` }); }
    await expect(startListingPhoto(scope, "poster", { id, contentType: "image/png", sizeBytes: 10 })).rejects.toThrow("6 photos");
    await expect(removeListingPhoto(scope, "stranger", { id, fileId: "file_1" })).rejects.toMatchObject({ status: 404 });
    await removeListingPhoto(scope, "poster", { id, fileId: "file_1" });
    expect((await ownListings(scope, "poster")).listings[0].photos).toHaveLength(5);
    await expect(removeListingPhoto(scope, "poster", { id, fileId: "file_1" })).rejects.toMatchObject({ status: 404 });
  });
  it("stops showing a photo once its file has expired", async () => {
    const { id } = await saveListing(scope, "poster", listing());
    vi.spyOn(files, "startUpload").mockResolvedValue({ fileId: "file_1", uploadUrl: "https://u", headers: {} });
    vi.spyOn(files, "finishUpload").mockResolvedValue(stored({ expiresAt: new Date(Date.now() - 1000).toISOString() }));
    await startListingPhoto(scope, "poster", { id, contentType: "image/png", sizeBytes: 10 });
    await finishListingPhoto(scope, "poster", { id, fileId: "file_1" });
    expect((await listingPage(scope, id)).photoUrls).toEqual([]);
    expect((await ownListings(scope, "poster")).listings[0].photos[0].url).toBeUndefined();
  });
  it("looks a place up only when switched on, and a failed lookup never stops a save", async () => {
    const call = vi.spyOn(server, "capability").mockResolvedValue({ displayName: "Pune, Maharashtra, India", latitude: 18.5, longitude: 73.8 });
    await saveListing(scope, "poster", listing({ location: "Pune" }));
    expect(call).not.toHaveBeenCalled();
    vi.stubEnv("PRAMAAN_LISTING_GEOCODE", "1");
    const { id } = await saveListing(scope, "poster", listing({ location: "Pune", title: "Placed" }));
    expect(call).toHaveBeenCalledWith("geo.address.geocode", { address: "Pune" });
    expect((await searchListings(scope, params("location=maharashtra"))).results.map(r => r.id)).toEqual([id]);
    await saveListing(scope, "poster", listing({ id, revision: 1, location: "Pune", title: "Same place" }));
    expect(call).toHaveBeenCalledTimes(1);
    call.mockRejectedValueOnce(new Error("boom"));
    const saved = await saveListing(scope, "poster", listing({ location: "Nowhere" }));
    expect((await listingPage(scope, saved.id)).location).toBe("Nowhere");
  });
  it("sends new listing text to review when screening is on", async () => {
    vi.stubEnv("PRAMAAN_TEXT_SCREENING", "1");
    const call = vi.spyOn(server, "capability").mockRejectedValue(new Error("down"));
    await saveListing(scope, "poster", listing());
    expect(call).toHaveBeenCalledWith("text.classify", { text: "Garden help\nWeekly lawn care" });
    expect((await moderationQueue(scope)).reports).toHaveLength(1);
  });
});

describe("applications", () => {
  const form = { name: "Sam", message: "I can help" };
  const posted = async () => (await saveListing(scope, "poster", listing())).id;
  const applied = async (member = "sam") => { const listingId = await posted(); const { id } = await apply(scope, member, { listingId, ...form }); return { listingId, id }; };
  it("applies once, never to your own, a closed, hidden or blocked listing", async () => {
    const listingId = await posted();
    await expect(apply(scope, "poster", { listingId, ...form })).rejects.toThrow("your own");
    await apply(scope, "sam", { listingId, ...form });
    await expect(apply(scope, "sam", { listingId, ...form })).rejects.toMatchObject({ status: 409 });
    await expect(apply(scope, "sam", { listingId: "nope", ...form })).rejects.toMatchObject({ status: 404 });
    await expect(apply(scope, "sam", { listingId: uuid, ...form })).rejects.toMatchObject({ status: 404 });
    await expect(apply(scope, "kim", { listingId, name: "", message: "x" })).rejects.toThrow("name");
    await moderate(scope, "poster", { action: "block", ref: "blocked" });
    await expect(apply(scope, "blocked", { listingId, ...form })).rejects.toMatchObject({ status: 404 });
    await closeListing(scope, "poster", listingId);
    await expect(apply(scope, "kim", { listingId, ...form })).rejects.toThrow("closed");
    const hidden = await posted();
    await hide(hidden);
    await expect(apply(scope, "kim", { listingId: hidden, ...form })).rejects.toMatchObject({ status: 404 });
  });
  it("shows each person only their own applications and the owner only their own listing's", async () => {
    const { listingId, id } = await applied();
    expect((await ownApplications(scope, "sam")).applications).toMatchObject([{ id, status: "new", listing: { id: listingId, title: "Garden help", open: true }, history: [{ status: "new", by: "you" }] }]);
    expect((await ownApplications(scope, "kim")).applications).toEqual([]);
    expect((await listingApplicants(scope, "poster", listingId)).applicants).toMatchObject([{ id, name: "Sam", message: "I can help", history: [{ status: "new", by: "the applicant" }] }]);
    await expect(listingApplicants(scope, "sam", listingId)).rejects.toMatchObject({ status: 404 });
    expect((await applicationsGet(route(`/api/pramaan/applications?listing=${listingId}`, undefined, "sam"))).status).toBe(404);
    expect((await applicationsGet(route("/api/pramaan/applications", undefined, "none"))).status).toBe(401);
  });
  it("moves through every status, recording who and when, for the owner alone", async () => {
    const { listingId, id } = await applied();
    await expect(moveApplication(scope, "sam", { id, revision: 1, status: "accepted" })).rejects.toMatchObject({ status: 404 });
    await expect(moveApplication(scope, "stranger", { id, revision: 1, status: "accepted" })).rejects.toMatchObject({ status: 404 });
    await expect(moveApplication(scope, "poster", { id, revision: 1, status: "hired" })).rejects.toThrow("status");
    await moveApplication(scope, "poster", { id, revision: 1, status: "shortlisted" });
    await expect(moveApplication(scope, "poster", { id, revision: 1, status: "declined" })).rejects.toMatchObject({ status: 409 });
    await moveApplication(scope, "poster", { id, revision: 2, status: "declined" });
    await moveApplication(scope, "poster", { id, revision: 3, status: "new" });
    await moveApplication(scope, "poster", { id, revision: 4, status: "accepted", by: "forged" });
    const [own] = (await ownApplications(scope, "sam")).applications;
    expect(own.status).toBe("accepted");
    expect(own.history.map(h => [h.status, h.by])).toEqual([["new", "you"], ["shortlisted", "the listing owner"], ["declined", "the listing owner"], ["new", "the listing owner"], ["accepted", "the listing owner"]]);
    expect(own.history.every(h => !Number.isNaN(Date.parse(h.at)))).toBe(true);
    expect((await listingApplicants(scope, "poster", listingId)).applicants[0].history.at(-1)).toMatchObject({ status: "accepted", by: "you" });
    expect(fakeRows<{ actor: string }>("crm_application_event").at(-1)!.actor).toBe("poster");
  });
  it("removes a blocked applicant from the owner's list, status moves and messages", async () => {
    const { listingId, id } = await applied();
    await moderate(scope, "sam", { action: "block", ref: "poster" });
    expect((await listingApplicants(scope, "poster", listingId)).applicants).toEqual([]);
    await expect(moveApplication(scope, "poster", { id, revision: 1, status: "accepted" })).rejects.toMatchObject({ status: 404 });
    await expect(messageApplicant(scope, "poster", { id, requestId: uuid, text: "Hi" })).rejects.toMatchObject({ status: 404 });
    const [own] = (await ownApplications(scope, "sam")).applications;
    expect(own.listing).toBeUndefined();
  });
  it("takes the title and messages away when the listing is hidden", async () => {
    const { listingId, id } = await applied();
    await messageApplicant(scope, "poster", { id, requestId: uuid, text: "Hello" });
    await hide(listingId);
    const [own] = (await ownApplications(scope, "sam")).applications;
    expect(own.listing).toBeUndefined();
    expect(own.messages).toEqual([]);
    expect((await listingApplicants(scope, "poster", listingId)).messagingOff).toBe(true);
    await expect(messageApplicant(scope, "poster", { id, requestId: "11111111-1111-4111-8111-111111111111", text: "Hi" })).rejects.toMatchObject({ status: 409 });
  });
  it("saves a message, emails a fixed notice once per draft, and never shares an address", async () => {
    const { listingId, id } = await applied();
    const request = { id, requestId: uuid, text: "Can you start Monday? https://evil.test" };
    await expect(messageApplicant(scope, "sam", request)).rejects.toMatchObject({ status: 404 });
    await expect(messageApplicant(scope, "poster", { ...request, requestId: "nope" })).rejects.toThrow("reload");
    expect(await messageApplicant(scope, "poster", request)).toEqual({ notice: "sent", note: "" });
    expect(await messageApplicant(scope, "poster", request)).toEqual({ notice: "sent", note: "" });
    const outbox = fakeRows<{ to: string; subject: string; text: string; key: string }>("crm_notice_outbox");
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ to: "applicant@example.com", subject: "You have a message about your application" });
    expect(outbox[0].text).toContain("Garden help");
    expect(outbox[0].text).not.toContain("evil.test");
    expect((await ownApplications(scope, "sam")).applications[0].messages.map(m => m.text)).toEqual([request.text]);
    const seen = JSON.stringify([await listingApplicants(scope, "poster", listingId), await ownApplications(scope, "sam")]);
    expect(seen).not.toContain("applicant@example.com");
  });
  it("keeps a typed title on one bounded line in the email", async () => {
    const { id: listingId } = await saveListing(scope, "poster", listing({ title: `Evil\ttitle ${"x".repeat(100)}` }));
    const { id } = await apply(scope, "sam", { listingId, ...form });
    await messageApplicant(scope, "poster", { id, requestId: uuid, text: "Hi" });
    const [mail] = fakeRows<{ text: string }>("crm_notice_outbox");
    expect(mail.text.split("\n")[0]).toMatch(/^The owner of the listing "Evil title x+" sent you a message\.$/);
    expect(mail.text.split("\n")[0].length).toBeLessThanOrEqual(107);
  });
  it("sends nothing to a person with no confirmed address, and says so", async () => {
    const { id } = await applied("mbr_unconfirmed");
    const result = await messageApplicant(scope, "poster", { id, requestId: uuid, text: "Hi" });
    expect(result).toMatchObject({ notice: "not-sent", note: expect.stringContaining("confirmed") });
    expect(fakeRows("crm_notice_outbox")).toHaveLength(0);
  });
  it("goes through the email capability when chosen, with a fixed key and no failure on any outcome", async () => {
    const { id } = await applied();
    vi.stubEnv("PRAMAAN_NOTICE_TRANSPORT", "capability");
    expect(await messageApplicant(scope, "poster", { id, requestId: uuid, text: "Hi" })).toMatchObject({ notice: "not-sent", note: expect.stringContaining("switched on") });
    vi.stubEnv("PRAMAAN_NOTICE_FROM", "notices@example.com");
    const call = vi.spyOn(server, "capability").mockResolvedValueOnce({ status: "running" });
    expect(await messageApplicant(scope, "poster", { id, requestId: "11111111-1111-4111-8111-111111111111", text: "Hi" })).toMatchObject({ notice: "pending" });
    expect(call).toHaveBeenCalledWith("email.send", expect.objectContaining({ to: "applicant@example.com", sender: "domain", from: "notices@example.com" }), { "Idempotency-Key": expect.stringMatching(/^en1-[0-9a-f]{64}$/) });
    call.mockRejectedValueOnce(new Error("timed out"));
    expect(await messageApplicant(scope, "poster", { id, requestId: "22222222-2222-4222-8222-222222222222", text: "Hi" })).toMatchObject({ notice: "unknown" });
  });
  it("attaches only the applicant's started file, of an allowed type, once", async () => {
    const { listingId, id } = await applied();
    const pdf = stored({ kind: "document", contentType: "application/pdf" });
    vi.spyOn(files, "startUpload").mockResolvedValue({ fileId: "file_1", uploadUrl: "https://u", headers: {} });
    const finish = vi.spyOn(files, "finishUpload").mockResolvedValue(pdf);
    const remove = vi.spyOn(files, "deleteUpload").mockResolvedValue({ deleted: true });
    await expect(startApplicationFile(scope, "poster", { id, contentType: "application/pdf", sizeBytes: 10 })).rejects.toMatchObject({ status: 404 });
    await expect(startApplicationFile(scope, "sam", { id, contentType: "text/html", sizeBytes: 10 })).rejects.toThrow("PDF");
    await expect(startApplicationFile(scope, "sam", { id, contentType: "application/pdf", sizeBytes: 10_000_001 })).rejects.toThrow("PDF");
    await startApplicationFile(scope, "sam", { id, contentType: "application/pdf", sizeBytes: 10 });
    await expect(finishApplicationFile(scope, "sam", { id, fileId: "file_other" })).rejects.toMatchObject({ status: 403 });
    finish.mockResolvedValueOnce(stored({ contentType: "text/html", kind: "data" }));
    await expect(finishApplicationFile(scope, "sam", { id, fileId: "file_1" })).rejects.toThrow("PDF");
    expect(remove).toHaveBeenCalled();
    await finishApplicationFile(scope, "sam", { id, fileId: "file_1" });
    expect((await listingApplicants(scope, "poster", listingId)).applicants[0].file).toEqual({ label: "PDF", url: "https://files.test/one" });
    expect((await ownApplications(scope, "sam")).applications[0].file).toEqual({ label: "PDF", url: "https://files.test/one" });
    await expect(startApplicationFile(scope, "sam", { id, contentType: "application/pdf", sizeBytes: 10 })).rejects.toMatchObject({ status: 409 });
  });
  it("guards its route like the listings route", async () => {
    const listingId = await posted();
    expect((await applicationsPost(route("/api/pramaan/applications", { action: "apply", listingId, ...form }, "none"))).status).toBe(401);
    expect((await applicationsPost(route("/api/pramaan/applications", { action: "apply", listingId, ...form }, "sam", "https://other.test"))).status).toBe(403);
    expect((await applicationsPost(route("/api/pramaan/applications", { action: "nope" }, "sam"))).status).toBe(400);
    expect((await applicationsPost(route("/api/pramaan/applications", { action: "apply", listingId, ...form }, "sam"))).status).toBe(200);
  });
});
