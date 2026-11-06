import * as memoryProfile from "../registry/memory/app/api/pramaan/memory/profile/route";
import * as activityReplay from "../registry/activity/app/api/pramaan/activity/deliveries/[id]/replay/route";
import { vi } from "vitest";
import * as approvals from "@/registry/approvals/app/api/pramaan/approvals/route";
import * as approval from "@/registry/approvals/app/api/pramaan/approvals/[id]/route";
import * as decide from "@/registry/approvals/app/api/pramaan/approvals/[id]/decide/route";
import * as missions from "@/registry/mission-runner/app/api/pramaan/missions/route";
import * as mission from "@/registry/mission-runner/app/api/pramaan/missions/[id]/route";
import * as estimate from "@/registry/mission-runner/app/api/pramaan/missions/[id]/estimate/route";
import * as run from "@/registry/mission-runner/app/api/pramaan/missions/[id]/run/route";
import * as job from "@/registry/mission-runner/app/api/pramaan/jobs/[id]/route";
import * as cancel from "@/registry/mission-runner/app/api/pramaan/jobs/[id]/cancel/route";

import * as exams from "@/registry/assessment/app/api/pramaan/assessment/exams/route";
import * as exam from "@/registry/assessment/app/api/pramaan/assessment/exams/[ref]/route";
import * as questions from "@/registry/assessment/app/api/pramaan/assessment/exams/[ref]/questions/route";
import * as publish from "@/registry/assessment/app/api/pramaan/assessment/exams/[ref]/publish/route";
import * as invitations from "@/registry/assessment/app/api/pramaan/assessment/exams/[ref]/invitations/route";
import * as invitation from "@/registry/assessment/app/api/pramaan/assessment/invitations/[ref]/route";
import * as revoke from "@/registry/assessment/app/api/pramaan/assessment/invitations/[ref]/revoke/route";
import * as result from "@/registry/assessment/app/api/pramaan/assessment/invitations/[ref]/result/route";
import * as integrity from "@/registry/assessment/app/api/pramaan/assessment/invitations/[ref]/integrity/route";
import * as priceOf from "@/registry/assessment/app/api/pramaan/assessment/estimate/route";

import * as wallet from "@/registry/wallet/app/api/pramaan/wallet/route";
import * as walletUsage from "@/registry/wallet/app/api/pramaan/wallet/usage/route";
import * as walletCustomer from "@/registry/wallet/app/api/pramaan/wallet/customers/[id]/route";

import * as connections from "@/registry/connections/app/api/pramaan/connections/route";
import * as connection from "@/registry/connections/app/api/pramaan/connections/[id]/route";
import * as connectionStart from "@/registry/connections/app/api/pramaan/connections/start/route";
import * as connectionRevoke from "@/registry/connections/app/api/pramaan/connections/revoke/route";
import * as connectionDelete from "@/registry/connections/app/api/pramaan/connections/delete/route";

import * as memories from "@/registry/memory/app/api/pramaan/memory/route";
import * as memoryOne from "@/registry/memory/app/api/pramaan/memory/[id]/route";
import * as memoryForget from "@/registry/memory/app/api/pramaan/memory/forget/route";
import * as memoryChanges from "@/registry/memory/app/api/pramaan/memory/changes/route";
import * as memoryOrg from "@/registry/memory/app/api/pramaan/memory/org/route";
import * as memoryOrgDecide from "@/registry/memory/app/api/pramaan/memory/org/decide/route";

import * as picker from "@/registry/superpower-picker/app/api/pramaan/picker/route";
import * as pickerOne from "@/registry/superpower-picker/app/api/pramaan/picker/[id]/route";
import * as pickerEstimate from "@/registry/superpower-picker/app/api/pramaan/picker/[id]/estimate/route";
import * as pickerRun from "@/registry/superpower-picker/app/api/pramaan/picker/[id]/run/route";

import * as consentList from "@/registry/consent/app/api/pramaan/consent/route";
import * as consentRemove from "@/registry/consent/app/api/pramaan/consent/remove/route";
import * as consentCheck from "@/registry/consent/app/api/pramaan/consent/check/route";
import * as consentStop from "@/registry/consent/app/api/pramaan/consent/unsubscribe/route";

import * as activity from "@/registry/activity/app/api/pramaan/activity/route";
import * as activityOne from "@/registry/activity/app/api/pramaan/activity/[id]/route";
import * as activityDeliveries from "@/registry/activity/app/api/pramaan/activity/deliveries/route";

import * as payoutsRoute from "@/registry/payouts/app/api/pramaan/payouts/route";
import * as payoutsSession from "@/registry/payouts/app/api/pramaan/payouts/session/route";
import * as identityRoute from "@/registry/identity-check/app/api/pramaan/identity/route";
import * as checkoutRoute from "@/registry/checkout/app/api/pramaan/checkout/route";
import * as chatRoute from "@/registry/chat/app/api/pramaan/chat/route";
import * as chatTool from "@/registry/chat/app/api/pramaan/chat/tool/route";
import * as accountRoute from "@/registry/account/app/api/pramaan/account/route";
import * as accountOrg from "@/registry/account/app/api/pramaan/account/organisation/route";
import * as subsRoute from "@/registry/subscriptions/app/api/pramaan/subscriptions/route";
import * as subsPortal from "@/registry/subscriptions/app/api/pramaan/subscriptions/portal/route";
import * as voiceRoute from "@/registry/voice-call/app/api/pramaan/voice/route";
import * as bookingRoute from "@/registry/booking/app/api/pramaan/booking/route";
import * as signingRoute from "@/registry/e-sign/app/api/pramaan/signing/route";
import * as signingOne from "@/registry/e-sign/app/api/pramaan/signing/[ref]/route";
import * as signingRemind from "@/registry/e-sign/app/api/pramaan/signing/[ref]/remind/route";
import * as signingDownload from "@/registry/e-sign/app/api/pramaan/signing/[ref]/download/route";
import * as uploadsRoute from "@/registry/upload/app/api/pramaan/uploads/route";
import * as uploadsOne from "@/registry/upload/app/api/pramaan/uploads/[id]/route";
import * as uploadsFinish from "@/registry/upload/app/api/pramaan/uploads/[id]/finish/route";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (request: Request, ctx: { params: Promise<any> }) => Response | Promise<Response>;

/** Every block route, in the app's own URL space. Each block adds its routes here. */
const routes: [RegExp, Record<string, Handler | undefined>][] = [
  [/^\/api\/pramaan\/approvals$/, approvals],
  [/^\/api\/pramaan\/approvals\/([^/]+)$/, approval],
  [/^\/api\/pramaan\/approvals\/([^/]+)\/decide$/, decide],
  [/^\/api\/pramaan\/missions$/, missions],
  [/^\/api\/pramaan\/missions\/([^/]+)$/, mission],
  [/^\/api\/pramaan\/missions\/([^/]+)\/estimate$/, estimate],
  [/^\/api\/pramaan\/missions\/([^/]+)\/run$/, run],
  [/^\/api\/pramaan\/jobs\/([^/]+)$/, job],
  [/^\/api\/pramaan\/jobs\/([^/]+)\/cancel$/, cancel],
  [/^\/api\/pramaan\/assessment\/exams$/, exams],
  [/^\/api\/pramaan\/assessment\/exams\/([^/]+)$/, exam],
  [/^\/api\/pramaan\/assessment\/exams\/([^/]+)\/questions$/, questions],
  [/^\/api\/pramaan\/assessment\/exams\/([^/]+)\/publish$/, publish],
  [/^\/api\/pramaan\/assessment\/exams\/([^/]+)\/invitations$/, invitations],
  [/^\/api\/pramaan\/assessment\/invitations\/([^/]+)$/, invitation],
  [/^\/api\/pramaan\/assessment\/invitations\/([^/]+)\/revoke$/, revoke],
  [/^\/api\/pramaan\/assessment\/invitations\/([^/]+)\/result$/, result],
  [/^\/api\/pramaan\/assessment\/invitations\/([^/]+)\/integrity$/, integrity],
  [/^\/api\/pramaan\/assessment\/estimate$/, priceOf],
  [/^\/api\/pramaan\/connections$/, connections],
  [/^\/api\/pramaan\/connections\/start$/, connectionStart],
  [/^\/api\/pramaan\/connections\/revoke$/, connectionRevoke],
  [/^\/api\/pramaan\/connections\/delete$/, connectionDelete],
  [/^\/api\/pramaan\/connections\/([^/]+)$/, connection],
  [/^\/api\/pramaan\/memory$/, memories],
  [/^\/api\/pramaan\/memory\/forget$/, memoryForget],
  [/^\/api\/pramaan\/memory\/changes$/, memoryChanges],
  [/^\/api\/pramaan\/memory\/org$/, memoryOrg],
  [/^\/api\/pramaan\/memory\/org\/decide$/, memoryOrgDecide],
  [/^\/api\/pramaan\/memory\/profile$/, memoryProfile],
  [/^\/api\/pramaan\/memory\/([^/]+)$/, memoryOne],
  [/^\/api\/pramaan\/picker$/, picker],
  [/^\/api\/pramaan\/picker\/([^/]+)$/, pickerOne],
  [/^\/api\/pramaan\/picker\/([^/]+)\/estimate$/, pickerEstimate],
  [/^\/api\/pramaan\/picker\/([^/]+)\/run$/, pickerRun],
  [/^\/api\/pramaan\/consent$/, consentList],
  [/^\/api\/pramaan\/consent\/remove$/, consentRemove],
  [/^\/api\/pramaan\/consent\/check$/, consentCheck],
  [/^\/api\/pramaan\/consent\/unsubscribe$/, consentStop],
  [/^\/api\/pramaan\/activity\/deliveries\/([^/]+)\/replay$/, activityReplay],
  [/^\/api\/pramaan\/activity$/, activity],
  [/^\/api\/pramaan\/activity\/deliveries$/, activityDeliveries],
  [/^\/api\/pramaan\/activity\/([^/]+)$/, activityOne],
  [/^\/api\/pramaan\/checkout$/, checkoutRoute],
  [/^\/api\/pramaan\/identity$/, identityRoute],
  [/^\/api\/pramaan\/payouts$/, payoutsRoute],
  [/^\/api\/pramaan\/payouts\/session$/, payoutsSession],
  [/^\/api\/pramaan\/chat$/, chatRoute],
  [/^\/api\/pramaan\/chat\/tool$/, chatTool],
  [/^\/api\/pramaan\/account$/, accountRoute],
  [/^\/api\/pramaan\/account\/organisation$/, accountOrg],
  [/^\/api\/pramaan\/subscriptions$/, subsRoute],
  [/^\/api\/pramaan\/subscriptions\/portal$/, subsPortal],
  [/^\/api\/pramaan\/voice$/, voiceRoute],
  [/^\/api\/pramaan\/booking$/, bookingRoute],
  [/^\/api\/pramaan\/signing$/, signingRoute],
  [/^\/api\/pramaan\/signing\/([^/]+)\/remind$/, signingRemind],
  [/^\/api\/pramaan\/signing\/([^/]+)\/download$/, signingDownload],
  [/^\/api\/pramaan\/signing\/([^/]+)$/, signingOne],
  [/^\/api\/pramaan\/uploads$/, uploadsRoute],
  [/^\/api\/pramaan\/uploads\/([^/]+)\/finish$/, uploadsFinish],
  [/^\/api\/pramaan\/uploads\/([^/]+)$/, uploadsOne],
  [/^\/api\/pramaan\/wallet$/, wallet],
  [/^\/api\/pramaan\/wallet\/usage$/, walletUsage],
  [/^\/api\/pramaan\/wallet\/customers\/([^/]+)$/, walletCustomer],
];

/** Serves one request through the block routes, in-process. The routes talk to the fake Pramaan. */
export async function callRoute(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname;
  for (const [pattern, module] of routes) {
    const m = path.match(pattern);
    const handler = m && module[request.method];
    if (handler) {
      const value = decodeURIComponent(m[1] ?? "");
      return handler(request, { params: Promise.resolve({ id: value, ref: value }) });
    }
  }
  return new Response("not found", { status: 404 });
}

/**
 * A browser `fetch` that serves this app's /api/pramaan routes in-process, signed in as `member`.
 * The routes talk to the fake Pramaan (PRAMAAN_FAKE=1), so the whole stack runs with no network.
 */
export function appFetch(member?: string) {
  return vi.fn(async (url: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (member) headers.set("cookie", `pramaan_member=${member}`);

    return callRoute(new Request(new URL(url, "http://app.test"), { ...init, headers }));
  });
}

/** Pass as the member to be signed out. With no member at all, the fake signs in the demo owner. */
export const SIGNED_OUT = "none";

/** A request to a route, as a signed-in member. */
export const asMember = (member: string | undefined, url: string, init: RequestInit = {}) =>
  new Request(new URL(url, "http://app.test"), {
    ...init,
    headers: { ...(init.headers as Record<string, string>), ...(member ? { cookie: `pramaan_member=${member}` } : {}) },
  });

/** POST a JSON body to a route, through the same path the browser uses. */
export const post = (member: string | undefined, url: string, body: unknown = {}, headers: Record<string, string> = {}) =>
  callRoute(asMember(member, url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }));

export const get = (member: string | undefined, url: string) => callRoute(asMember(member, url));

/** Runs the fake's clock by hand so missions advance without waiting. */
export function useClock(fake: { now: () => number; stepMs: number }, stepMs = 1_000) {
  const clock = { t: Date.now() };
  fake.now = () => clock.t;
  fake.stepMs = stepMs;
  return { advance: (ms: number) => (clock.t += ms), clock };
}
