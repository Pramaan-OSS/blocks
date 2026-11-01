// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContactsPanel } from "@/components/pramaan/contacts/contacts-panel";
import { PipelinePanel } from "@/components/pramaan/pipeline/pipeline-panel";
import { getContacts, updateContacts } from "@/lib/pramaan/contacts";
import { getPipeline, updatePipeline } from "@/lib/pramaan/pipeline";
import { resetCrmFake } from "@/lib/pramaan/crm-data";
import * as contactsRoute from "@/registry/contacts/app/api/pramaan/contacts/route";
import * as pipelineRoute from "@/registry/pipeline/app/api/pramaan/pipeline/route";

const person = { action: "save", kind: "person", name: "Alex", email: "", companyId: "" };
const deal = { action: "save", kind: "deal", title: "First contract", value: 125.29, owner: "Alex", stage: "New" };
async function appFetch(url: string, init?: RequestInit) {
  const req = new Request(`http://localhost${url}`, init);
  const route = url.includes("pipeline") ? pipelineRoute : contactsRoute;
  return req.method === "GET" ? route.GET(req) : route.POST(req);
}
beforeEach(() => { resetCrmFake(); vi.stubGlobal("fetch", vi.fn(appFetch)); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("review 6 and 8: drafts and focus", () => {
  it("pipeline focuses the form, returns on cancel/save, and a different card's move preserves the draft", async () => {
    await updatePipeline("mbr_owner", deal);
    await updatePipeline("mbr_owner", { ...deal, title: "Other card" });
    const user = userEvent.setup();
    render(<PipelinePanel />);
    const edit = await screen.findByRole("button", { name: "Edit First contract" });
    await user.click(edit);
    const title = screen.getByRole("textbox", { name: "Title" });
    expect(document.activeElement).toBe(title);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(document.activeElement).toBe(edit);
    await user.click(edit);
    await user.clear(screen.getByRole("textbox", { name: "Title" }));
    await user.type(screen.getByRole("textbox", { name: "Title" }), "Draft title");
    await user.selectOptions(screen.getByRole("combobox", { name: "Stage for Other card" }), "Won");
    await screen.findByText("Other card moved to Won.");
    expect((screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement).value).toBe("Draft title");
    expect(within(screen.getByRole("form", { name: "Card" })).queryByRole("combobox", { name: "Stage" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Save card" }));
    const savedEdit = await screen.findByRole("button", { name: "Edit Draft title" });
    await waitFor(() => expect(document.activeElement).toBe(savedEdit));
    expect(screen.queryByRole("form", { name: "Card" })).toBeNull();
    expect((await getPipeline("mbr_owner")).deals.map(d => [d.title, d.stage])).toEqual([["Draft title", "New"], ["Other card", "Won"]]);
    await user.click(screen.getByRole("button", { name: "Add card" }));
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Title" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add card" }));
  });
  it("a move in another tab cannot be undone by an old form; the conflict keeps the draft and can load the latest", async () => {
    const card = (await updatePipeline("mbr_owner", deal)).deals[0];
    const user = userEvent.setup();
    render(<PipelinePanel />);
    await user.click(await screen.findByRole("button", { name: "Edit First contract" }));
    await user.clear(screen.getByRole("textbox", { name: "Title" }));
    await user.type(screen.getByRole("textbox", { name: "Title" }), "Unsaved draft");
    await updatePipeline("mbr_owner", { action: "move", id: card.id, revision: 0, stage: "Won" });
    await user.click(screen.getByRole("button", { name: "Save card" }));
    await screen.findByText("This card changed since you opened it. Reload to see the latest.");
    expect((screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement).value).toBe("Unsaved draft");
    expect((await getPipeline("mbr_owner")).deals[0]).toMatchObject({ title: deal.title, stage: "Won" });
    await user.click(screen.getByRole("button", { name: "Refresh board" }));
    await waitFor(() => expect(within(screen.getByRole("region", { name: "Won" })).getByRole("article", { name: deal.title })).toBeTruthy());
    expect((screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement).value).toBe("Unsaved draft");
    await user.click(screen.getByRole("button", { name: "Replace draft with latest card" }));
    await waitFor(() => expect((screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement).value).toBe(deal.title));
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Title" }));
  });
  it("contacts focus and return correctly; a note from another tab makes the old draft stale", async () => {
    const contact = (await updateContacts("mbr_owner", person)).contacts[0];
    const user = userEvent.setup();
    render(<ContactsPanel />);
    await user.click(await screen.findByRole("button", { name: "Add person" }));
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Name" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add person" }));
    await user.click(screen.getByRole("button", { name: "Alex" }));
    await user.click(screen.getByRole("button", { name: "Edit contact" }));
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Name" }));
    await user.clear(screen.getByRole("textbox", { name: "Name" }));
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Draft name");
    await updateContacts("mbr_owner", { action: "note", id: contact.id, revision: 0, note: "Keep this note" });
    expect((screen.getByRole("textbox", { name: "Name" }) as HTMLInputElement).value).toBe("Draft name");
    await user.click(screen.getByRole("button", { name: "Save contact" }));
    await screen.findByText("This contact changed since you opened it. Reload to see the latest.");
    expect((await getContacts("mbr_owner")).contacts[0].name).toBe("Alex");
    await user.click(screen.getByRole("button", { name: "Replace draft with latest contact" }));
    await screen.findByText("Latest contact loaded. Please enter your changes again.");
    await user.clear(screen.getByRole("textbox", { name: "Name" }));
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Saved name");
    await user.click(screen.getByRole("button", { name: "Save contact" }));
    await screen.findByRole("button", { name: "Saved name" });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit contact" })));
  });
  it("keyboard moves retain focus during failure, ignore repeats while pending and announce board edges", async () => {
    await updatePipeline("mbr_owner", deal);
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    let moveRequests = 0;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (init?.body && JSON.parse(String(init.body)).action === "move" && ++moveRequests === 1) {
        await pending;
        return Response.json({ error: { message: "Please try moving this card again." } }, { status: 503 });
      }
      return appFetch(url, init);
    });
    const user = userEvent.setup();
    render(<PipelinePanel />);
    const handle = await screen.findByRole("button", { name: "Move First contract" });
    handle.focus();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("status").textContent).toBe("Already in the first stage.");
    await user.keyboard("{ArrowRight}");
    expect(handle.getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(handle);
    await user.keyboard("{ArrowRight}");
    expect(moveRequests).toBe(1);
    release();
    await screen.findByText("Please try moving this card again.");
    expect(document.activeElement).toBe(handle);
    await user.keyboard("{ArrowRight}");
    await screen.findByText("First contract moved to In progress.");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Move First contract" })));
    await user.keyboard("{ArrowRight}");
    await screen.findByText("First contract moved to Won.");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Move First contract" })));
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("status").textContent).toBe("Already in the last stage.");
    const won = screen.getByRole("region", { name: "Won" });
    expect(within(won).getByText("1 card · £125.29").hasAttribute("aria-label")).toBe(false);
  });
});

describe("review 9: confirmed deletion", () => {
  it("deleting a card needs confirmation and cancellation leaves it unchanged", async () => {
    await updatePipeline("mbr_owner", deal);
    const user = userEvent.setup();
    render(<PipelinePanel />);
    await user.click(await screen.findByRole("button", { name: "Delete First contract" }));
    expect((await getPipeline("mbr_owner")).deals).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Keep card" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect((await getPipeline("mbr_owner")).deals).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Delete First contract" }));
    await user.click(within(screen.getByRole("alertdialog", { name: "Delete card?" })).getByRole("button", { name: "Confirm delete" }));
    await screen.findByText("Card deleted.");
    await waitFor(() => expect(screen.queryByRole("article", { name: deal.title })).toBeNull());
    expect((await getPipeline("mbr_owner")).deals).toHaveLength(0);
  });
  it("confirms note and contact deletion without removing them early", async () => {
    const contact = (await updateContacts("mbr_owner", person)).contacts[0];
    await updateContacts("mbr_owner", { action: "note", id: contact.id, revision: 0, note: "A note" });
    const user = userEvent.setup();
    render(<ContactsPanel />);
    await user.click(await screen.findByRole("button", { name: "Alex" }));
    await user.click(screen.getByRole("button", { name: "Delete note 1" }));
    expect((await getContacts("mbr_owner")).contacts[0].notes).toHaveLength(1);
    await user.click(within(screen.getByRole("alertdialog", { name: "Delete note?" })).getByRole("button", { name: "Confirm delete" }));
    await screen.findByText("Note deleted.");
    expect((await getContacts("mbr_owner")).contacts[0].notes).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Delete contact" }));
    expect((await getContacts("mbr_owner")).contacts).toHaveLength(1);
    await user.click(within(screen.getByRole("alertdialog", { name: "Delete contact?" })).getByRole("button", { name: "Confirm delete" }));
    await screen.findByText("Contact deleted.");
    expect((await getContacts("mbr_owner")).contacts).toHaveLength(0);
  });
});

it("stage-select failure returns focus to the move handle", async () => {
  await updatePipeline("mbr_owner", deal);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (init?.body && JSON.parse(String(init.body)).action === "move") {
      await pending;
      return Response.json({ error: { message: "Please try that stage change again." } }, { status: 503 });
    }
    return appFetch(url, init);
  });
  const user = userEvent.setup();
  render(<PipelinePanel />);
  const stage = await screen.findByRole("combobox", { name: "Stage for First contract" });
  await user.selectOptions(stage, "Won");
  const handle = screen.getByRole("button", { name: "Move First contract" });
  expect(document.activeElement).not.toBe(handle);
  release();
  await screen.findByText("Please try that stage change again.");
  await waitFor(() => expect(document.activeElement).toBe(handle));
  expect((await getPipeline("mbr_owner")).deals[0].stage).toBe("New");
});

it("editing blocks notes and deletion on that contact without discarding the note draft", async () => {
  const contact = (await updateContacts("mbr_owner", person)).contacts[0];
  await updateContacts("mbr_owner", { action: "note", id: contact.id, revision: 0, note: "Existing note" });
  const user = userEvent.setup();
  render(<ContactsPanel />);
  await user.click(await screen.findByRole("button", { name: "Alex" }));
  await user.type(screen.getByRole("textbox", { name: "New note" }), "Pending note");
  await user.click(screen.getByRole("button", { name: "Edit contact" }));
  const note = screen.getByRole("textbox", { name: "New note" }) as HTMLTextAreaElement;
  expect(note.disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Add note" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Delete note 1" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Delete contact" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.submit(note.closest("form")!);
  await user.click(screen.getByRole("button", { name: "Delete note 1" }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect((await getContacts("mbr_owner")).contacts[0]).toMatchObject({ revision: 1, notes: [{ text: "Existing note" }] });
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(note.disabled).toBe(false);
  expect(note.value).toBe("Pending note");
  expect((screen.getByRole("button", { name: "Delete contact" }) as HTMLButtonElement).disabled).toBe(false);
  await user.click(screen.getByRole("button", { name: "Add note" }));
  await screen.findByText("Pending note");
  expect((await getContacts("mbr_owner")).contacts[0].notes).toHaveLength(2);
});

it("editing blocks keyboard, drag, stage-select and deletion only on that card", async () => {
  const card = (await updatePipeline("mbr_owner", deal)).deals[0];
  await updatePipeline("mbr_owner", { ...deal, title: "Other card" });
  const user = userEvent.setup();
  render(<PipelinePanel />);
  await user.click(await screen.findByRole("button", { name: "Edit First contract" }));
  const article = screen.getByRole("article", { name: "First contract" });
  const handle = screen.getByRole("button", { name: "Move First contract" });
  expect(handle.getAttribute("aria-disabled")).toBe("true");
  expect(article.draggable).toBe(false);
  expect((screen.getByRole("combobox", { name: "Stage for First contract" }) as HTMLSelectElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Delete First contract" }) as HTMLButtonElement).disabled).toBe(true);
  handle.focus();
  await user.keyboard("{ArrowRight}");
  fireEvent.drop(screen.getByRole("region", { name: "Won" }), { dataTransfer: { getData: () => card.id } });
  await waitFor(() => expect((screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement).value).toBe("First contract"));
  expect((await getPipeline("mbr_owner")).deals[0]).toMatchObject({ revision: 0, stage: "New" });
  const otherStage = screen.getByRole("combobox", { name: "Stage for Other card" }) as HTMLSelectElement;
  expect(otherStage.disabled).toBe(false);
  await user.selectOptions(otherStage, "Won");
  await screen.findByText("Other card moved to Won.");
  expect(screen.getByRole("form", { name: "Card" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Save card" }));
  await waitFor(() => expect(screen.queryByRole("form", { name: "Card" })).toBeNull());
  expect(screen.getByRole("button", { name: "Move First contract" }).getAttribute("aria-disabled")).toBe("false");
  expect((screen.getByRole("button", { name: "Delete First contract" }) as HTMLButtonElement).disabled).toBe(false);
  expect((await getPipeline("mbr_owner")).deals[0]).toMatchObject({ revision: 1, stage: "New" });
});
