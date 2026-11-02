import { connection } from "next/server";
import { readBody } from "@/lib/pramaan/crm-data";
import { socialContext, requireMember, protectSocial, socialError, socialResponse } from "@/lib/pramaan/social-context";
import { ownProfile, publicProfile, saveProfile, startProfilePhoto, finishProfilePhoto } from "@/lib/pramaan/profiles";
export async function GET(request: Request) {
  await connection();
  try {
    await protectSocial(request);
    const { scope, member } = await socialContext(request);
    const person = new URL(request.url).searchParams.get("person");
    if (person) return socialResponse(await publicProfile(scope, person, member));
    requireMember(member);
    return socialResponse(await ownProfile(scope, member));
  } catch (e) { return socialError(e); }
}
export async function POST(request: Request) {
  try {
    const body = await readBody(request);
    await protectSocial(request, body);
    const { scope, member } = await socialContext(request); requireMember(member);
    if (body.action === "photo-start") return socialResponse(await startProfilePhoto(scope, member, body));
    if (body.action === "photo-finish") return socialResponse(await finishProfilePhoto(scope, member, body.fileId));
    return socialResponse(await saveProfile(scope, member, body));
  } catch (e) { return socialError(e); }
}
