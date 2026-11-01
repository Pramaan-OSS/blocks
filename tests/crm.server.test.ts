import { beforeEach, describe, expect, it } from "vitest";
import { resetCrmFake } from "@/lib/pramaan/crm-data";
import { getContacts, updateContacts } from "@/lib/pramaan/contacts";
import { getPipeline, updatePipeline } from "@/lib/pramaan/pipeline";
import * as contactsRoute from "@/registry/contacts/app/api/pramaan/contacts/route";
import * as pipelineRoute from "@/registry/pipeline/app/api/pramaan/pipeline/route";

beforeEach(resetCrmFake);
const person = { action: "save", kind: "person", name: "Alex Green", email: "alex@example.com", companyId: "" };
const deal = { action: "save", kind: "deal", title: "Spring contract", value: 125.29, owner: "Alex", stage: "New" };
const request = (body?: unknown, cookie = "mbr_owner", origin = "http://localhost") => new Request("http://localhost/api/pramaan/contacts", { method: body ? "POST" : "GET", headers: { "content-type": "application/json", cookie: `pramaan_member=${cookie}`, origin }, body: body ? JSON.stringify(body) : undefined });
describe("contacts fake", () => {
  it("adds people and companies, edits, links, searches supplied records, and records notes and history", async () => {
    const first = await updateContacts("owner", { ...person, kind: "company", name: "Green Works" });
    const company = first.contacts[0];
    const second = await updateContacts("owner", { ...person, companyId: company.id });
    const contact = second.contacts[1];
    await updateContacts("owner", { ...person, id: contact.id, revision: 0, name: "Alex Blue", companyId: company.id });
    await updateContacts("owner", { action: "note", id: contact.id, revision: 1, note: "Follow up next week" });
    const data = await getContacts("owner");
    expect(data.contacts[1]).toMatchObject({ name: "Alex Blue", companyId: company.id, notes: [{ text: "Follow up next week" }] });
    expect(data.contacts[1].history.map(h => h.text)).toEqual(["Note added", "Contact updated", "Contact added"]);
    await updateContacts("owner", { ...person, id: contact.id, revision: 2, companyId: "" });
    expect((await getContacts("owner")).contacts[1].history[0].text).toBe("Company link changed");
    expect(await getContacts("other")).toEqual({ contacts: [] });
  });
  it("rejects invalid input and foreign links without changing stored data", async () => {
    const own = await updateContacts("owner", person);
    const foreign = (await updateContacts("other", { ...person, kind: "company" })).contacts[0];
    for (const input of [{ ...person, name: " " }, { ...person, email: "bad" }, { ...person, kind: "alien" }, { ...person, companyId: foreign.id }, { ...person, id: "missing" }, { action: "note", id: own.contacts[0].id, revision: 0, note: "" }, { action: "note", id: "missing", note: "Hi" }]) {
      await expect(updateContacts("owner", input)).rejects.toThrow();
    }
    expect(await getContacts("owner")).toEqual(own);
  });
  it("returns independent copies after sequential fake additions", async () => {
    for (let i = 0; i < 20; i++) await updateContacts("owner", { ...person, name: `Contact ${i}` });
    const snapshot = await getContacts("owner");
    snapshot.contacts.length = 0;
    expect((await getContacts("owner")).contacts).toHaveLength(20);
  });
});
describe("pipeline fake", () => {
  it("keeps deals, tasks, owner, value, edits and stage moves across reads", async () => {
    const first = await updatePipeline("owner", deal);
    const id = first.deals[0].id;
    await updatePipeline("owner", { ...deal, id, revision: 0, kind: "task", title: "Renewal", owner: "Sam", value: 0.29 });
    await updatePipeline("owner", { action: "move", id, revision: 1, stage: "In progress" });
    expect((await getPipeline("owner")).deals[0]).toMatchObject({ title: "Renewal", owner: "Sam", value: 0.29, kind: "task", stage: "In progress" });
    expect(await getPipeline("other")).toEqual({ deals: [] });
  });
  it("rejects bad stages, amounts, kinds and foreign card references", async () => {
    const before = await updatePipeline("owner", deal);
    const id = before.deals[0].id;
    for (const input of [{ ...deal, value: -1 }, { ...deal, value: NaN }, { ...deal, value: 1.234 }, { ...deal, value: 1.230001 }, { ...deal, owner: "" }, { ...deal, stage: "Missing" }, { ...deal, kind: "other" }, { action: "move", id: "foreign", stage: "Won" }, { action: "move", id, revision: 1, stage: "Invalid" }]) await expect(updatePipeline("owner", input)).rejects.toThrow();
    expect(await getPipeline("owner")).toEqual(before);
  });
});
describe("CRM routes", () => {
  it("requires sign-in and blocks viewer writes and other browser origins", async () => {
    for (const route of [contactsRoute, pipelineRoute]) {
      expect((await route.GET(request(undefined, "none"))).status).toBe(401);
      expect((await route.POST(request(person, "mbr_viewer"))).status).toBe(403);
      expect((await route.POST(request(person, "mbr_owner", "http://elsewhere.test"))).status).toBe(403);
    }
    expect(await getContacts("mbr_owner")).toEqual({ contacts: [] });
  });
  it("persists through routes, rejects bad bodies and never returns raw errors", async () => {
    expect((await contactsRoute.POST(request(person))).status).toBe(200);
    const result = await contactsRoute.GET(request());
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect((await result.json()).contacts[0].name).toBe("Alex Green");
    const bad = new Request("http://localhost/api/pramaan/contacts", { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
    expect((await contactsRoute.POST(bad)).status).toBe(400);
    expect((await pipelineRoute.POST(request(deal))).status).toBe(200);
    expect((await (await pipelineRoute.GET(request())).json()).deals).toHaveLength(1);
    expect((await contactsRoute.POST(request({ ...person, padding: "x".repeat(20001) }))).status).toBe(400);
  });
  it("production default fails closed without opening a database", async () => {
    const old = process.env.PRAMAAN_FAKE;
    process.env.PRAMAAN_FAKE = "0";
    try { expect((await contactsRoute.GET(request())).status).toBe(401); }
    finally { process.env.PRAMAAN_FAKE = old; }
  });
});
