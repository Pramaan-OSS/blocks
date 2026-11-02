import { connection } from "next/server";
import { isHidden, isBlocked } from "@/lib/pramaan/moderation";
import { socialContext, protectSocial, socialError, socialResponse } from "@/lib/pramaan/social-context";
export async function GET(request: Request) {
  await connection();
  if (process.env.PRAMAAN_FAKE !== "1") return new Response(null, { status: 404 });
  try {
    await protectSocial(request);
    const { scope, member } = await socialContext(request);
    return socialResponse({ itemVisible: !await isHidden("demo-item", scope), personVisible: !await isBlocked(member, "mbr_sample", scope) });
  } catch (e) { return socialError(e); }
}
