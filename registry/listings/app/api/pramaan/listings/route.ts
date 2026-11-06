import { connection } from "next/server";
import { CrmProblem, readBody } from "@/lib/pramaan/crm-data";
import { socialContext, requireMember, socialError, socialResponse } from "@/lib/pramaan/social-context";
import { closeListing, finishListingPhoto, listingPage, ownListings, protectListings, removeListingPhoto, saveListing, searchListings, startListingPhoto } from "@/lib/pramaan/listings";
export async function GET(request: Request) {
  await connection();
  try {
    await protectListings(request);
    const { scope, member } = await socialContext(request);
    const params = new URL(request.url).searchParams;
    const id = params.get("id");
    if (id) return socialResponse(await listingPage(scope, id, member));
    if (params.has("mine")) { requireMember(member); return socialResponse(await ownListings(scope, member)); }
    return socialResponse(await searchListings(scope, params, member));
  } catch (e) { return socialError(e); }
}
export async function POST(request: Request) {
  try {
    const body = await readBody(request);
    await protectListings(request, body);
    const { scope, member } = await socialContext(request); requireMember(member);
    if (body.action === "save") return socialResponse(await saveListing(scope, member, body));
    if (body.action === "close") return socialResponse(await closeListing(scope, member, body.id));
    if (body.action === "photo-start") return socialResponse(await startListingPhoto(scope, member, body));
    if (body.action === "photo-finish") return socialResponse(await finishListingPhoto(scope, member, body));
    if (body.action === "photo-remove") return socialResponse(await removeListingPhoto(scope, member, body));
    throw new CrmProblem("Choose an action to continue.");
  } catch (e) { return socialError(e); }
}
