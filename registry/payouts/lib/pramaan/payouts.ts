import "server-only";
import { PramaanError } from "@pramaan/sdk";
import { humanize } from "@/lib/pramaan/plain";
import { capability, currentViewer, signedOut, type Viewer } from "@/lib/pramaan/server";

// Server half of the payouts block: the seller's own payment account. Reads its status
// (payments.account.status), starts or resumes setup (payments.account.connect) and opens a
// short-lived session for the provider's embedded screens (payments.account.session.create).
// The session's client secret goes to the account owner's browser only, once, and is never
// logged or kept here.

export type AccountState = "ready" | "pending" | "restricted";

export interface Account {
  readonly state: AccountState;
  readonly canTakePayments: boolean;
  readonly canReceivePayouts: boolean;
  /** What is still needed, in plain words. */
  readonly due: string[];
  /** Only owners and admins can open the setup screens. */
  readonly canManage: boolean;
}

export type SetupSession =
  | { readonly mode: "embedded"; readonly clientSecret: string; readonly publishableKey: string; readonly expiresAt: string; readonly standIn: boolean }
  | { readonly mode: "hosted"; readonly url: string };

const DUE: Record<string, string> = {
  external_account: "A bank account to receive payouts",
  "business_profile.url": "Your business website",
  tos_acceptance: "Accept the terms of service",
  "business_profile.mcc": "What your business sells",
};

const dueWord = (key: string) => DUE[key] ?? humanize(key.replace(/\./g, " "));

async function signedIn(request: Request): Promise<Viewer> {
  const viewer = await currentViewer(request);
  if (!viewer.memberId) throw signedOut("Your payment account shows here once you're signed in.");
  return viewer;
}

export async function getAccount(request: Request): Promise<Account> {
  const viewer = await signedIn(request);
  const r = await capability<{ status: AccountState; chargesEnabled: boolean; payoutsEnabled: boolean; requirementsDue: string[] }>("payments.account.status", {});
  return { state: r.status, canTakePayments: r.chargesEnabled, canReceivePayouts: r.payoutsEnabled, due: r.requirementsDue.map(dueWord), canManage: viewer.canApprove };
}

/** "setup" is the onboarding screen alone; "manage" adds the payouts and balance screens. */
const VIEWS = { setup: [], manage: ["payouts", "balances"] } as const;

export async function openSession(request: Request, body: { view?: unknown }): Promise<SetupSession> {
  const viewer = await signedIn(request);
  if (!viewer.canApprove) throw new PramaanError("forbidden", "Only an owner or admin can change payment settings. Ask one of them.", { status: 403 });
  const view = body.view === undefined ? "setup" : body.view;
  if (view !== "setup" && view !== "manage") throw new PramaanError("invalid_request", "Choose setup or manage.", { status: 400 });
  const base = (process.env.APP_URL || new URL(request.url).origin).replace(/\/$/, "");
  const connect = await capability<{ onboardingMode?: "embedded"; onboardingUrl?: string }>("payments.account.connect", { returnUrl: `${base}/payouts`, refreshUrl: `${base}/payouts` });
  // An older account sets up on a hosted page instead of in this one.
  if (connect.onboardingMode !== "embedded" && connect.onboardingUrl) return { mode: "hosted", url: connect.onboardingUrl };
  const s = await capability<{ clientSecret: string; publishableKey: string; expiresAt: string }>("payments.account.session.create", { components: [...VIEWS[view]] });
  return { mode: "embedded", clientSecret: s.clientSecret, publishableKey: s.publishableKey, expiresAt: s.expiresAt, standIn: process.env.PRAMAAN_FAKE === "1" };
}
