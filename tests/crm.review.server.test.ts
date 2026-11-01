import { beforeEach, describe, expect, it, vi } from "vitest";
import { changeData, crmRoute, readData, resetCrmFake, text } from "@/lib/pramaan/crm-data";
import { getContacts, updateContacts } from "@/lib/pramaan/contacts";
import { getPipeline, updatePipeline } from "@/lib/pramaan/pipeline";
import * as route from "@/registry/contacts/app/api/pramaan/contacts/route";

beforeEach(resetCrmFake);
const person = { action: "save", kind: "person", name: "Alex", email: "", companyId: "" };
const deal = { action: "save", kind: "deal", title: "Spring contract", value: 0, owner: "Alex", stage: "New" };
function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/pramaan/contacts", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}
async function problem(response: Response, status: number, message: string) {
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ error: { message } });
}
describe("review 1: stale changes", () => {
  it("rejects an old card edit or move after a newer move, preserving all newer fields", async () => {
    const card = (await updatePipeline("owner", deal)).deals[0];
    await updatePipeline("owner", { action: "move", id: card.id, revision: 0, stage: "Won" });
    await expect(updatePipeline("owner", { ...deal, id: card.id, revision: 0, title: "Old edit" })).rejects.toMatchObject({ status: 409, message: "This card changed since you opened it. Reload to see the latest." });
    await expect(updatePipeline("owner", { action: "move", id: card.id, revision: 0, stage: "New" })).rejects.toMatchObject({ status: 409 });
    expect((await getPipeline("owner")).deals[0]).toMatchObject({ stage: "Won", title: deal.title, revision: 1 });
  });
  it("requires a revision for every existing-card write and only moves change an existing stage", async () => {
    const card = (await updatePipeline("owner", deal)).deals[0];
    await expect(updatePipeline("owner", { ...deal, id: card.id })).rejects.toMatchObject({ status: 409 });
    await updatePipeline("owner", { ...deal, id: card.id, revision: 0, stage: "Won", title: "New title" });
    expect((await getPipeline("owner")).deals[0]).toMatchObject({ title: "New title", stage: "New", revision: 1 });
  });
  it("a same-stage move is a no-op, including its revision", async () => {
    const before = await updatePipeline("owner", deal);
    expect(await updatePipeline("owner", { action: "move", id: before.deals[0].id, revision: 0, stage: "New" })).toEqual(before);
  });
  it("rejects a stale contact edit after a note and supports old rows without revisions", async () => {
    const contact = (await updateContacts("owner", person)).contacts[0];
    await updateContacts("owner", { action: "note", id: contact.id, revision: 0, note: "New information" });
    await expect(updateContacts("owner", { ...person, id: contact.id, revision: 0, name: "Old name" })).rejects.toMatchObject({ status: 409, message: "This contact changed since you opened it. Reload to see the latest." });
    expect((await getContacts("owner")).contacts[0]).toMatchObject({ name: "Alex", revision: 1 });
    await changeData("contacts", "legacy", { contacts: [{ ...contact }] }, state => { delete (state.contacts[0] as Partial<typeof contact>).revision; });
    expect((await getContacts("legacy")).contacts[0]).toMatchObject({ revision: 0 });
    await updateContacts("legacy", { ...person, id: contact.id, revision: 0, name: "Current" });
    expect((await getContacts("legacy")).contacts[0].name).toBe("Current");
  });
});
describe("review 2: storage limits", () => {
  it("caps contacts at 2000 and cards at 500, but still allows editing existing entries", async () => {
    const contact = (await updateContacts("owner", person)).contacts[0];
    await changeData("contacts", "owner", { contacts: [contact] }, state => { state.contacts = Array.from({ length: 2000 }, (_, i) => ({ ...contact, id: `contact-${i}` })); });
    await expect(updateContacts("owner", person)).rejects.toThrow("This workspace is full. Remove some contacts to add more.");
    await updateContacts("owner", { ...person, id: "contact-0", revision: 0, name: "Updated" });
    expect((await getContacts("owner")).contacts).toHaveLength(2000);
    const card = (await updatePipeline("owner", deal)).deals[0];
    await changeData("pipeline", "owner", { deals: [card] }, state => { state.deals = Array.from({ length: 500 }, (_, i) => ({ ...card, id: `card-${i}` })); });
    await expect(updatePipeline("owner", deal)).rejects.toThrow("This workspace is full. Remove some cards to add more.");
    await updatePipeline("owner", { ...deal, id: "card-0", revision: 0, title: "Updated" });
    expect((await getPipeline("owner")).deals).toHaveLength(500);
  });
  it("caps notes at 200 and retains only the latest 50 history entries", async () => {
    const contact = (await updateContacts("owner", person)).contacts[0];
    for (let revision = 0; revision < 200; revision++) await updateContacts("owner", { action: "note", id: contact.id, revision, note: `Note ${revision}` });
    const before = await getContacts("owner");
    expect(before.contacts[0].history).toHaveLength(50);
    expect(before.contacts[0].notes[0].text).toBe("Note 199");
    await expect(updateContacts("owner", { action: "note", id: contact.id, revision: 200, note: "Too many" })).rejects.toThrow("This contact has 200 notes. Remove a note to add another.");
    expect(await getContacts("owner")).toEqual(before);
  });
  it("bounds total stored bytes as well as counts and leaves the document unchanged", async () => {
    await changeData("contacts", "owner", { padding: "" }, s => { s.padding = "Small"; });
    await expect(changeData("contacts", "owner", { padding: "" }, s => { s.padding = "x".repeat(4 * 1024 * 1024); })).rejects.toThrow("This workspace is full. Remove some entries before saving more.");
    expect(await readData("contacts", "owner", {})).toEqual({ padding: "Small" });
  });
});
describe("review 3 and 4: request byte limits", () => {
  it("rejects an otherwise valid oversized body with the size message", async () => {
    await problem(await route.POST(request({ ...person, padding: "x".repeat(20001) })), 400, "Please use a shorter entry.");
    expect(await getContacts("mbr_owner")).toEqual({ contacts: [] });
  });
  it("rejects a declared oversized body before reading any bytes", async () => {
    const req = request(person, { "content-length": "20001" });
    const getReader = vi.spyOn(req.body!, "getReader");
    await problem(await route.POST(req), 400, "Please use a shorter entry.");
    expect(getReader).not.toHaveBeenCalled();
  });
  it("stops and cancels a chunked multibyte body before reading the rest", async () => {
    let reads = 0;
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { reads++; controller.enqueue(new TextEncoder().encode(reads === 1 ? '{"padding":"' : "界".repeat(4000))); }, cancel }, { highWaterMark: 0 });
    const req = new Request("http://localhost/api/pramaan/contacts", { method: "POST", headers: { "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit);
    // The old unbounded request.text() path fails immediately instead of exhausting memory.
    vi.spyOn(req, "text").mockRejectedValue(new Error("Must not buffer the whole body"));
    await problem(await route.POST(req), 400, "Please use a shorter entry.");
    expect(reads).toBe(3);
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("counts bytes, not string length, even without Content-Length", async () => {
    await problem(await route.POST(request({ ...person, padding: "界".repeat(7000) })), 400, "Please use a shorter entry.");
  });
});
describe("review 7: wording", () => {
  it("distinguishes missing and overlong entries", () => {
    expect(() => text("", "a name")).toThrow("Enter a name.");
    expect(() => text("x".repeat(201), "a name")).toThrow("Use a name of up to 200 characters.");
  });
  it("unexpected read and write failures have a neutral message", async () => {
    for (const req of [new Request("http://localhost/api/pramaan/contacts"), request(person)]) {
      await problem(await crmRoute(req, async () => { throw new Error("private database detail"); }), 500, "Something went wrong. Please try again.");
    }
  });
  it("describes zero values and rejected origins plainly", async () => {
    await expect(updatePipeline("owner", { ...deal, value: -1 })).rejects.toThrow("Enter a value of £0 or more, with up to two decimal places.");
    await problem(await route.POST(request(person, { origin: "http://elsewhere.test" })), 403, "Please reload the page and try again.");
  });
});
describe("review 10: same-site JSON writes", () => {
  it("accepts JSON without Origin and refuses non-JSON bodies", async () => {
    expect((await route.POST(request(person))).status).toBe(200);
    for (const type of ["text/plain", "application/x-www-form-urlencoded"]) await problem(await route.POST(request(person, { "content-type": type })), 415, "Please check the form and try again.");
  });
  it("checks the configured public app origin behind a proxy", async () => {
    vi.stubEnv("CRM_APP_URL", "https://crm.example.com");
    try {
      expect((await route.POST(request(person, { origin: "https://crm.example.com" }))).status).toBe(200);
      await problem(await route.POST(request(person, { origin: "http://localhost", "x-forwarded-host": "localhost" })), 403, "Please reload the page and try again.");
    } finally { vi.unstubAllEnvs(); }
  });
});
describe("review 11: storage parity", () => {
  it("fake serialises dates and optional fields like jsonb, on return as well as storage", async () => {
    const date = new Date("2026-11-01T12:00:00Z");
    const result = await changeData("contacts", "owner", { value: {} as unknown }, state => { state.value = { date, absent: undefined }; });
    const expected = { value: { date: date.toISOString() } };
    expect(result).toEqual(expected);
    expect(await readData("contacts", "owner", {})).toEqual(expected);
  });
  it("rejects an unexpected table name at runtime", async () => {
    await expect(readData("unexpected" as "contacts", "owner", {})).rejects.toThrow("Choose a workspace list.");
  });
});

describe("review 9: safe removals", () => {
  it("deleting a company atomically clears links and makes old person edits stale", async () => {
    const company = (await updateContacts("owner", { ...person, kind: "company", name: "Studio" })).contacts[0];
    const linked = (await updateContacts("owner", { ...person, companyId: company.id })).contacts[1];
    await expect(updateContacts("other", { action: "delete", id: company.id, revision: 0 })).rejects.toMatchObject({ status: 404 });
    await updateContacts("owner", { action: "delete", id: company.id, revision: 0 });
    const data = await getContacts("owner");
    expect(data.contacts).toHaveLength(1);
    expect(data.contacts[0]).toMatchObject({ companyId: "", revision: 1, history: [{ text: "Company link removed" }, { text: "Contact added" }] });
    await expect(updateContacts("owner", { ...person, id: linked.id, revision: 0 })).rejects.toMatchObject({ status: 409 });
  });
  it("stale deletes cannot remove a changed card, contact or shifted note", async () => {
    const card = (await updatePipeline("owner", deal)).deals[0];
    await updatePipeline("owner", { action: "move", id: card.id, revision: 0, stage: "Won" });
    await expect(updatePipeline("owner", { action: "delete", id: card.id, revision: 0 })).rejects.toMatchObject({ status: 409 });
    expect((await getPipeline("owner")).deals).toHaveLength(1);
    const contact = (await updateContacts("owner", person)).contacts[0];
    await updateContacts("owner", { action: "note", id: contact.id, revision: 0, note: "First note" });
    await updateContacts("owner", { action: "note", id: contact.id, revision: 1, note: "Second note" });
    await expect(updateContacts("owner", { action: "delete-note", id: contact.id, revision: 1, noteIndex: 0 })).rejects.toMatchObject({ status: 409 });
    await expect(updateContacts("owner", { action: "delete", id: contact.id, revision: 0 })).rejects.toMatchObject({ status: 409 });
    expect((await getContacts("owner")).contacts[0].notes.map(n => n.text)).toEqual(["Second note", "First note"]);
    await updateContacts("owner", { action: "delete-note", id: contact.id, revision: 2, noteIndex: 1 });
    expect((await getContacts("owner")).contacts[0].notes.map(n => n.text)).toEqual(["Second note"]);
  });
});
