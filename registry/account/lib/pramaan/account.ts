import "server-only";
import { PramaanError } from "@pramaan/sdk";
import { asViewer, currentViewer, pramaan, signedOut } from "@/lib/pramaan/server";

// Server half of the account block: who you are, your organisation's name, and (for owners and
// admins) the team. Calls GET /v1/members/me, GET /v1/members, GET and PUT /v1/organization. No
// member id leaves the server: people are shown by email and role.

export type Role = "owner" | "admin" | "member" | "viewer";

interface MemberRow {
  readonly member_id: string;
  readonly email?: string;
  readonly role: Role;
  readonly can_approve: boolean;
  readonly may_approve: boolean;
  readonly spend_limit?: { readonly limit_micro: number; readonly period: "day" | "month" };
}

export interface Person {
  /** Their email, when Pramaan has one. */
  readonly email?: string;
  readonly role: Role;
  readonly mayApprove: boolean;
  readonly spendLimit?: { readonly limitMicro: number; readonly period: "day" | "month" };
  readonly isYou: boolean;
}

export interface Account {
  readonly you: Person;
  /** The name people outside your team see; null until it is set. */
  readonly organisationName: string | null;
  readonly canEditName: boolean;
  /** Only owners and admins see the team. */
  readonly team?: readonly Person[];
  /** Where keys and members are managed, from PRAMAAN_DASHBOARD_URL. */
  readonly dashboardUrl?: string;
}

const bad = (message: string) => new PramaanError("invalid_request", message, { status: 400 });
const canManage = (role: Role) => role === "owner" || role === "admin";

const person = (m: MemberRow, you: string): Person => ({
  ...(m.email ? { email: m.email } : {}),
  role: m.role,
  mayApprove: m.may_approve,
  ...(m.spend_limit ? { spendLimit: { limitMicro: m.spend_limit.limit_micro, period: m.spend_limit.period } } : {}),
  isYou: m.member_id === you,
});

async function signedIn(request: Request) {
  const viewer = await currentViewer(request);
  if (!viewer.memberId) throw signedOut("Your account details show here once you're signed in.");
  return { viewer, headers: asViewer(viewer) };
}

export async function getAccount(request: Request): Promise<Account> {
  const { viewer, headers } = await signedIn(request);
  const [me, org] = await Promise.all([
    pramaan<MemberRow>("/v1/members/me", { headers }),
    pramaan<{ name: string | null }>("/v1/organization", { headers }),
  ]);
  const manage = canManage(me.role);
  const team = manage ? (await pramaan<{ results: MemberRow[] }>("/v1/members", { headers })).results.map((m) => person(m, viewer.memberId!)) : undefined;
  return {
    you: person(me, viewer.memberId!),
    organisationName: org.name,
    canEditName: manage,
    ...(team ? { team } : {}),
    ...(process.env.PRAMAAN_DASHBOARD_URL ? { dashboardUrl: process.env.PRAMAAN_DASHBOARD_URL } : {}),
  };
}

/** Sets the name people outside your team see. Owners and admins only; the API checks again. */
export async function setOrganisationName(request: Request, body: { name?: unknown }): Promise<{ organisationName: string }> {
  const { headers } = await signedIn(request);
  const me = await pramaan<MemberRow>("/v1/members/me", { headers });
  if (!canManage(me.role)) throw new PramaanError("forbidden", "Only an owner or an admin can change the organisation's name.", { status: 403 });
  const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
  if (name.length < 2 || name.length > 200) throw bad("The name must be 2 to 200 characters.");
  const res = await pramaan<{ name: string | null }>("/v1/organization", { method: "PUT", body: { name }, headers });
  return { organisationName: res.name ?? name };
}
