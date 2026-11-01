import "server-only";
import { PramaanError } from "@pramaan/sdk";
import { capability, signedOut } from "@/lib/pramaan/server";
import { currentEndUserRef } from "@/lib/pramaan/session";

// Server half of the identity check block: starts a hosted verification for the signed-in person and
// reads how it stands. Calls identity.verification.create and identity.verification.get. The
// provider's own screen collects the ID and selfie; this app never sees them. The answer to the
// browser holds the decision and each check's result only: the name, date of birth and document
// number the check read are personal data and are not passed on.

export type VerificationState = "waiting" | "in_progress" | "in_review" | "approved" | "declined" | "expired" | "stopped";

export interface Started {
  /** The provider's own screen, for an iframe or a new tab. */
  readonly url: string;
  /** An opaque handle for reading the result. Keep it in the browser; never show it. */
  readonly ref: string;
}

export interface Result {
  readonly state: VerificationState;
  readonly checks: { readonly label: string; readonly result: "Passed" | "Failed" | "Needs a look" }[];
}

const bad = (message: string) => new PramaanError("invalid_request", message, { status: 400 });
const REF = /^ref_[A-Za-z0-9_-]{3,120}$/;
const LANGUAGE = /^[a-z]{2,3}(-[A-Za-z]{2})?$/;

export async function startVerification(request: Request, body: { language?: unknown }): Promise<Started> {
  const endUserId = await currentEndUserRef(request);
  if (!endUserId) throw signedOut("You need to be signed in to check your identity.");
  if (body.language !== undefined && (typeof body.language !== "string" || !LANGUAGE.test(body.language))) throw bad("Choose a language like en or es.");
  const key = request.headers.get("idempotency-key") ?? undefined;
  const r = await capability<{ verificationUrl: string; ref: string }>(
    "identity.verification.create",
    { endUserId, ...(body.language ? { language: body.language } : {}) },
    key ? { "Idempotency-Key": key } : undefined,
  );
  return { url: r.verificationUrl, ref: r.ref };
}

const STATE: Record<string, VerificationState> = {
  not_started: "waiting", awaiting_user: "waiting", in_progress: "in_progress", in_review: "in_review", resubmitted: "in_review",
  approved: "approved", declined: "declined", expired: "expired", abandoned: "stopped",
};

const CHECK: Record<string, string> = { document: "ID document", liveness: "Selfie check", face_match: "Face match", address: "Address", screening: "Background screening" };
const RESULT = { passed: "Passed", failed: "Failed", review: "Needs a look" } as const;

export async function getVerification(ref: string | null): Promise<Result> {
  if (!ref || !REF.test(ref)) throw bad("That check couldn't be found. Start again.");
  const r = await capability<{ status: string; checks: { check: string; status?: string }[] }>("identity.verification.get", { ref });
  return {
    // Anything unclear reads as waiting, never as approved.
    state: STATE[r.status] ?? "waiting",
    checks: r.checks.flatMap((c) => (c.status && c.status in RESULT ? [{ label: CHECK[c.check] ?? c.check.replace(/_/g, " ").replace(/^./, (x) => x.toUpperCase()), result: RESULT[c.status as keyof typeof RESULT] }] : [])),
  };
}
