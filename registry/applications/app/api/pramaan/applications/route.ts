import { connection } from "next/server";
import { CrmProblem, readBody } from "@/lib/pramaan/crm-data";
import { socialContext, requireMember, socialError, socialResponse } from "@/lib/pramaan/social-context";
import { protectListings } from "@/lib/pramaan/listings";
import { apply, finishApplicationFile, listingApplicants, messageApplicant, moveApplication, ownApplications, startApplicationFile } from "@/lib/pramaan/applications";
export async function GET(request: Request) {
  await connection();
  try {
    await protectListings(request);
    const { scope, member } = await socialContext(request); requireMember(member);
    const listing = new URL(request.url).searchParams.get("listing");
    return socialResponse(listing ? await listingApplicants(scope, member, listing) : await ownApplications(scope, member));
  } catch (e) { return socialError(e); }
}
export async function POST(request: Request) {
  try {
    const body = await readBody(request);
    await protectListings(request, body);
    const { scope, member } = await socialContext(request); requireMember(member);
    if (body.action === "apply") return socialResponse(await apply(scope, member, body));
    if (body.action === "file-start") return socialResponse(await startApplicationFile(scope, member, body));
    if (body.action === "file-finish") return socialResponse(await finishApplicationFile(scope, member, body));
    if (body.action === "move") return socialResponse(await moveApplication(scope, member, body));
    if (body.action === "message") return socialResponse(await messageApplicant(scope, member, body));
    throw new CrmProblem("Choose an action to continue.");
  } catch (e) { return socialError(e); }
}
