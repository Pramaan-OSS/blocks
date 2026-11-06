// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ListingDetail, ListingsBrowser, MyListings } from "@/components/pramaan/listings/listings-panel";
import { ApplicantsPanel, ApplyPanel, MyApplications } from "@/components/pramaan/applications/applications-panel";
import { resetCrmFake } from "@/lib/pramaan/crm-data";
import { resetPublicLimits } from "@/lib/pramaan/public-guard";
import { closeListing, saveListing } from "@/lib/pramaan/listings";
import { apply } from "@/lib/pramaan/applications";
import * as listings from "@/registry/listings/app/api/pramaan/listings/route";
import * as applications from "@/registry/applications/app/api/pramaan/applications/route";
import * as moderation from "@/registry/moderation/app/api/pramaan/moderation/route";
const scope = "demo";
const item = (extra = {}) => ({ title: "Garden help", description: "Weekly lawn care", category: "Services", priceText: "$25 an hour", price: 25, location: "Pune", ...extra });
let member = "mbr_owner";
beforeEach(() => {
  resetCrmFake(); member = "mbr_owner"; vi.stubEnv("PRAMAAN_SOCIAL_SCOPE", "demo"); vi.stubEnv("PRAMAAN_TEXT_SCREENING", "");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const request = new Request(`http://app.test${url}`, { ...init, headers: { ...(init.headers as object), cookie: `pramaan_member=${member}` } });
    const route = url.includes("/moderation") ? moderation : url.includes("/applications") ? applications : listings;
    return request.method === "GET" ? route.GET(request) : route.POST(request);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const noRawIds = (id?: string) => { expect(document.body.textContent).not.toMatch(/mbr_|poster-ref|listing:/); if (id) expect(document.body.textContent).not.toContain(id); };

it("searches with filters, pages and says plainly when nothing matches", async () => {
  for (let i = 0; i < 21; i++) { resetPublicLimits(); await saveListing(scope, "poster-ref", item({ title: `Lawn ${i}`, category: i ? "Services" : "Jobs" })); }
  const user = userEvent.setup(); render(<ListingsBrowser />);
  await screen.findByText("21 listings");
  expect(screen.getByText("Page 1 of 2")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Next page" }));
  await screen.findByText("Page 2 of 2");
  await user.selectOptions(screen.getByRole("combobox", { name: "Category" }), "Jobs");
  await user.click(screen.getByRole("button", { name: "Search listings" }));
  await screen.findByText("1 listing");
  expect(screen.getByRole("link", { name: "Lawn 0" }).getAttribute("href")).toMatch(/^\/listings\//);
  await user.type(screen.getByRole("textbox", { name: "Search" }), "nothing here");
  await user.click(screen.getByRole("button", { name: "Search listings" }));
  await screen.findByText("No listings match. Try fewer filters.");
  noRawIds();
});
it("shows a plain error for a price range that can't match, with a way back", async () => {
  const user = userEvent.setup(); render(<ListingsBrowser />);
  await user.type(await screen.findByRole("spinbutton", { name: "Lowest price" }), "9");
  await user.type(screen.getByRole("spinbutton", { name: "Highest price" }), "1");
  await user.click(screen.getByRole("button", { name: "Search listings" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Make the lowest price smaller than the highest.");
});
it("posts and edits a listing, then closes it after a confirm", async () => {
  const user = userEvent.setup(); render(<MyListings />);
  await screen.findByText("You haven't posted a listing yet.");
  await user.click(screen.getByRole("button", { name: "Post a listing" }));
  await user.type(screen.getByRole("textbox", { name: "Title" }), "Garden help");
  await user.type(screen.getByRole("textbox", { name: "Description" }), "Weekly");
  await user.selectOptions(screen.getByRole("combobox", { name: "Category" }), "Services");
  await user.click(screen.getByRole("button", { name: "Save listing" }));
  await screen.findByText("Listing posted. You can add photos below.");
  await user.click(await screen.findByRole("button", { name: "Edit Garden help" }));
  const title = screen.getByRole("textbox", { name: "Title" });
  await user.clear(title); await user.type(title, "Lawn help");
  await user.click(screen.getByRole("button", { name: "Save listing" }));
  await screen.findByText("Listing saved.");
  await user.click(await screen.findByRole("button", { name: "Close Lawn help" }));
  await user.click(await screen.findByRole("button", { name: "Close listing" }));
  await screen.findByText("Listing closed.");
  await waitFor(() => expect(screen.getByText("Closed")).toBeTruthy());
  expect(screen.queryByRole("button", { name: "Edit Lawn help" })).toBeNull();
});
it("gives signed-out visitors no safety controls and signed-in ones both", async () => {
  const { id } = await saveListing(scope, "poster-ref", item());
  member = "none"; render(<ListingDetail id={id} withApplications />);
  await screen.findByRole("article", { name: "Listing" });
  expect(screen.queryByRole("region", { name: /Safety/ })).toBeNull();
  expect(screen.getByRole("link", { name: "Apply" })).toBeTruthy();
  noRawIds(id); cleanup();
  member = "viewer"; render(<ListingDetail id={id} />);
  await screen.findByRole("region", { name: "Safety for This listing" });
  expect(screen.getByRole("region", { name: "Safety for The person who posted this" })).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Apply" })).toBeNull();
  noRawIds(id);
});
it("says a listing is gone without revealing why", async () => {
  member = "viewer"; render(<ListingDetail id="00000000-0000-4000-8000-000000000000" />);
  expect((await screen.findByRole("alert")).textContent).toContain("This listing isn't available.");
});
it("applies with a message and then shows the application and its status", async () => {
  const { id } = await saveListing(scope, "poster-ref", item());
  member = "sam"; const user = userEvent.setup(); render(<ApplyPanel listing={id} />);
  await user.type(await screen.findByRole("textbox", { name: "Your name" }), "Sam");
  await user.type(screen.getByRole("textbox", { name: "Message" }), "I can help");
  await user.click(screen.getByRole("button", { name: "Send application" }));
  await screen.findByText("Application sent.");
  cleanup(); render(<MyApplications />);
  await screen.findByRole("link", { name: "Garden help" });
  expect(screen.getAllByText("New").length).toBeGreaterThan(0);
  expect(screen.getByText("New, set by you", { exact: false })).toBeTruthy();
  noRawIds(id);
});
it("tells owners, closed listings and signed-out people they can't apply", async () => {
  const { id } = await saveListing(scope, "poster-ref", item());
  member = "poster-ref"; render(<ApplyPanel listing={id} />);
  await screen.findByText("This is your listing."); cleanup();
  member = "none"; render(<ApplyPanel listing={id} />);
  await screen.findByText("Sign in to apply."); cleanup();
  await closeListing(scope, "poster-ref", id);
  member = "sam"; render(<ApplyPanel listing={id} />);
  await screen.findByText("This listing is closed.");
  expect(screen.queryByRole("button", { name: "Send application" })).toBeNull();
});
it("lets the owner move an applicant and message them, with a plain outcome", async () => {
  const { id } = await saveListing(scope, "poster-ref", item());
  await apply(scope, "sam-ref", { listingId: id, name: "Sam", message: "I can help" });
  member = "poster-ref"; const user = userEvent.setup(); render(<ApplicantsPanel listing={id} />);
  await user.click(await screen.findByRole("button", { name: "Shortlist: Sam" }));
  await screen.findByText("Sam: Shortlisted.");
  const card = await screen.findByRole("listitem", { name: "Sam" });
  await within(card).findByText(/Shortlisted, set by you/);
  await user.type(within(card).getByRole("textbox", { name: "Message Sam" }), "Can you start Monday?");
  await user.click(within(card).getByRole("button", { name: "Send message" }));
  await screen.findByText("Message saved.");
  await within(card).findByText(/Email sent\./);
  expect(document.body.textContent).not.toMatch(/sam-ref|@example/);
  noRawIds(id);
});
it("refuses a stranger the applicant list in plain words", async () => {
  const { id } = await saveListing(scope, "poster-ref", item());
  member = "stranger"; render(<ApplicantsPanel listing={id} />);
  expect((await screen.findByRole("alert")).textContent).toContain("This listing isn't available.");
});
