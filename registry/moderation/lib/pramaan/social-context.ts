import "server-only";
import { currentMemberId } from "@/lib/pramaan/session";
import { CrmProblem, crmDatabase, fakeRows } from "@/lib/pramaan/crm-data";
import { clientIp, limitPublic, verifyPublicBot, PUBLIC_READ_LIMIT, PUBLIC_WINDOW_MS, PUBLIC_WRITE_LIMIT } from "@/lib/pramaan/public-guard";
import { PramaanError } from "@pramaan/sdk";

/** Wire these two lookups to trusted host membership data before enabling production. */
export function socialScope() {
  const scope = process.env.PRAMAAN_SOCIAL_SCOPE || (process.env.PRAMAAN_FAKE === "1" ? "demo" : "");
  if (!scope) throw new CrmProblem("This community is not connected yet.", 503);
  return scope;
}
export async function socialContext(request: Request) {
  const member = await currentMemberId(request);
  return { member, scope: socialScope() };
}
export async function mayModerate(member: string, _scope: string): Promise<boolean> {
  return process.env.PRAMAAN_FAKE === "1" && ["mbr_owner", "mbr_admin"].includes(member);
}
export function requireMember(member: string | undefined): asserts member is string {
  if (!member) throw new CrmProblem("Sign in to continue.", 401);
}
function refuseForeignOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(process.env.PRAMAAN_SOCIAL_ORIGIN || request.url).origin) throw new CrmProblem("Please reload the page and try again.", 403);
}
export async function protectSocial(request: Request, body: Record<string, unknown> = {}) {
  const write = request.method !== "GET";
  if (write) refuseForeignOrigin(request);
  // Count first, so a flood of requests cannot run up bot-check calls.
  limitPublic(`social:${request.method}`, clientIp(request), write ? PUBLIC_WRITE_LIMIT : PUBLIC_READ_LIMIT, PUBLIC_WINDOW_MS);
  if (write) await verifyPublicBot(request, body.botCheckToken);
}
const MEMBER_WRITE_LIMIT = 60;
const MEMBER_READ_LIMIT = 240;
const SHARED_ADDRESS_MULTIPLIER = 10;
/**
 * For signed-in screens that write and poll often, such as a feed or a conversation. Each person has
 * their own limit; one address gets room for a shared office, so `protectSocial`'s ten writes a minute
 * would not stop a normal conversation.
 */
export async function protectMember(request: Request, body: Record<string, unknown> = {}) {
  const write = request.method !== "GET";
  if (write) refuseForeignOrigin(request);
  limitPublic(`member:${request.method}`, clientIp(request), (write ? PUBLIC_WRITE_LIMIT : PUBLIC_READ_LIMIT) * SHARED_ADDRESS_MULTIPLIER, PUBLIC_WINDOW_MS);
  const { scope, member } = await socialContext(request);
  requireMember(member);
  limitPublic(`person:${request.method}`, member, write ? MEMBER_WRITE_LIMIT : MEMBER_READ_LIMIT, PUBLIC_WINDOW_MS);
  if (write) await verifyPublicBot(request, body.botCheckToken);
  return { scope, member };
}
export function socialError(error: unknown) {
  const status = error instanceof CrmProblem ? error.status : error instanceof PramaanError ? error.status ?? 503 : 500;
  // Never expose a remote error, database detail or internal reference.
  const message = error instanceof CrmProblem ? error.message : status === 429 ? "Too many requests. Please try again later." : "Couldn't finish that. Please try again.";
  return Response.json({ error: { message } }, { status, headers: { "Cache-Control": "no-store" } });
}
export const socialResponse = (data: unknown) => Response.json(data, { headers: { "Cache-Control": "no-store" } });

/** Wire to the person's confirmed address. Undefined sends nothing; never use an address from a form. */
export async function memberEmail(person: string, _scope: string): Promise<string | undefined> {
  return process.env.PRAMAAN_FAKE === "1" ? `${person}@example.com` : undefined;
}

/** Replace with a local, scope-checked content lookup in the consuming kit. */
export async function moderationSubject(kind: "item" | "person", ref: string, scope: string): Promise<{ label: string; href?: string; excerpt?: string }> {
  if (process.env.PRAMAAN_FAKE === "1" && ref === "demo-item") return { label: "Sample community post", excerpt: "A sample post for trying the review controls." };
  if (kind === "person") return { label: "Reported person", href: `/profiles/${encodeURIComponent(ref)}` };
  return await listingSubject(ref, scope) ?? { label: "Reported item" };
}
const LISTING_REF = /^listing:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
/** The listings block's reports. Anyone can submit any reference, and the table may not be installed. */
async function listingSubject(ref: string, scope: string) {
  const id = LISTING_REF.exec(ref)?.[1];
  if (!id) return undefined;
  const [row] = process.env.PRAMAAN_FAKE === "1"
    ? fakeRows<{ scope: string; id: string; title: string; description: string }>("crm_listing").filter(l => l.scope === scope && l.id === id)
    : await crmDatabase()`select title, description from crm_listing where scope = ${scope} and id = ${id}`.catch(() => []);
  return row && listingSubjectOf({ title: row.title, description: row.description });
}
/** What reviewers read about a listing, stored on its report. */
export const listingSubjectOf = (listing: { title: string; description: string }) => ({ label: `Listing: ${listing.title}`, excerpt: String(listing.description).slice(0, 240) });
