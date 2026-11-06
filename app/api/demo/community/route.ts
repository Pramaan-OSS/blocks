import { connection } from "next/server";
import { feedAction } from "@/lib/pramaan/feed";
import { messagingAction } from "@/lib/pramaan/messaging";
import { isHidden, isBlocked } from "@/lib/pramaan/moderation";
import { ownProfile, saveProfile } from "@/lib/pramaan/profiles";
import { socialContext, protectSocial, requireMember, socialError, socialResponse } from "@/lib/pramaan/social-context";
// The sample member writes a post and sends the signed-in person a message.
export async function POST(request: Request) {
  if (process.env.PRAMAAN_FAKE !== "1") return new Response(null, { status: 404 });
  try {
    const { scope, member } = await socialContext(request); requireMember(member);
    const sample = "mbr_sample";
    if (!(await ownProfile(scope, sample)).revision) await saveProfile(scope, sample, { revision: 0, name: "Sam Rivera", bio: "Sample community member", links: [], public: { name: true, bio: true, links: false, photo: false } });
    await feedAction(scope, sample, { action: "post", text: "Hello from the sample community." });
    const { id } = await messagingAction(scope, sample, { action: "start", person: member }) as { id: string };
    await messagingAction(scope, sample, { action: "send", id, text: "Hi, this is Sam. Good to meet you." });
    return socialResponse({ ok: true });
  } catch (e) { return socialError(e); }
}
export async function GET(request: Request) {
  await connection();
  if (process.env.PRAMAAN_FAKE !== "1") return new Response(null, { status: 404 });
  try {
    await protectSocial(request);
    const { scope, member } = await socialContext(request);
    return socialResponse({ itemVisible: !await isHidden("demo-item", scope), personVisible: !await isBlocked(member, "mbr_sample", scope) });
  } catch (e) { return socialError(e); }
}
