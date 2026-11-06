import { connection } from "next/server";
import { readBody } from "@/lib/pramaan/crm-data";
import { protectMember, socialError, socialResponse } from "@/lib/pramaan/social-context";
import { conversationList, messagingAction, thread } from "@/lib/pramaan/messaging";
export async function GET(request: Request) {
  await connection();
  try {
    const { scope, member } = await protectMember(request);
    const params = new URL(request.url).searchParams;
    const conversation = params.get("conversation");
    return socialResponse(conversation ? await thread(scope, member, conversation, params.get("before")) : await conversationList(scope, member));
  } catch (e) { return socialError(e); }
}
export async function POST(request: Request) {
  try {
    const body = await readBody(request);
    const { scope, member } = await protectMember(request, body);
    return socialResponse(await messagingAction(scope, member, body));
  } catch (e) { return socialError(e); }
}
