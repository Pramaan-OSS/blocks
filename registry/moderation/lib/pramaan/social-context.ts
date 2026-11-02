import "server-only";
import { currentMemberId } from "@/lib/pramaan/session";
import { CrmProblem } from "@/lib/pramaan/crm-data";
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
export async function protectSocial(request: Request, body: Record<string, unknown> = {}) {
  const write = request.method !== "GET";
  if (write) {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(process.env.PRAMAAN_SOCIAL_ORIGIN || request.url).origin) throw new CrmProblem("Please reload the page and try again.", 403);
  }
  // Count first, so a flood of requests cannot run up bot-check calls.
  limitPublic(`social:${request.method}`, clientIp(request), write ? PUBLIC_WRITE_LIMIT : PUBLIC_READ_LIMIT, PUBLIC_WINDOW_MS);
  if (write) await verifyPublicBot(request, body.botCheckToken);
}
export function socialError(error: unknown) {
  const status = error instanceof CrmProblem ? error.status : error instanceof PramaanError ? error.status ?? 503 : 500;
  // Never expose a remote error, database detail or internal reference.
  const message = error instanceof CrmProblem ? error.message : status === 429 ? "Too many requests. Please try again later." : "Couldn't finish that. Please try again.";
  return Response.json({ error: { message } }, { status, headers: { "Cache-Control": "no-store" } });
}
export const socialResponse = (data: unknown) => Response.json(data, { headers: { "Cache-Control": "no-store" } });

/** Replace with a local, scope-checked content lookup in the consuming kit. */
export async function moderationSubject(kind: "item" | "person", ref: string, _scope: string): Promise<{ label: string; href?: string; excerpt?: string }> {
  if (process.env.PRAMAAN_FAKE === "1" && ref === "demo-item") return { label: "Sample community post", excerpt: "A sample post for trying the review controls." };
  if (kind === "person") return { label: "Reported person", href: `/profiles/${encodeURIComponent(ref)}` };
  return { label: "Reported item" };
}
