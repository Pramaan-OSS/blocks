import { connection } from "next/server";
import { CrmProblem, readBody } from "@/lib/pramaan/crm-data";
import { socialContext, requireMember, mayModerate, protectSocial, socialError, socialResponse } from "@/lib/pramaan/social-context";
import { moderate, moderationQueue } from "@/lib/pramaan/moderation";
export async function GET(request: Request) {
  await connection();
  try {
    await protectSocial(request);
    const { scope, member } = await socialContext(request); requireMember(member);
    if (!await mayModerate(member, scope)) throw new CrmProblem("Only owners and admins can review reports.", 403);
    return socialResponse(await moderationQueue(scope, member));
  } catch (e) { return socialError(e); }
}
export async function POST(request: Request) {
  try {
    const body = await readBody(request); await protectSocial(request, body);
    const { scope, member } = await socialContext(request); requireMember(member);
    return socialResponse(await moderate(scope, member, body));
  } catch (e) { return socialError(e); }
}
