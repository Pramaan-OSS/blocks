import { connection } from "next/server";
import { readBody } from "@/lib/pramaan/crm-data";
import { protectMember, socialError, socialResponse } from "@/lib/pramaan/social-context";
import { feedAction, homeFeed, personFeed, postComments } from "@/lib/pramaan/feed";
export async function GET(request: Request) {
  await connection();
  try {
    const { scope, member } = await protectMember(request);
    const params = new URL(request.url).searchParams;
    const person = params.get("person"); const post = params.get("post"); const cursor = params.get("cursor");
    if (post) return socialResponse(await postComments(scope, member, post));
    return socialResponse(person ? await personFeed(scope, member, person, cursor) : await homeFeed(scope, member, cursor));
  } catch (e) { return socialError(e); }
}
export async function POST(request: Request) {
  try {
    const body = await readBody(request);
    const { scope, member } = await protectMember(request, body);
    return socialResponse(await feedAction(scope, member, body));
  } catch (e) { return socialError(e); }
}
