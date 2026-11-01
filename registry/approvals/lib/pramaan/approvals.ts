import "server-only";
import { PramaanError } from "@pramaan/sdk";
import { asViewer, currentViewer, pramaan, type Viewer } from "@/lib/pramaan/server";

// Server half of the approval inbox: GET /v1/approvals, GET /v1/approvals/{id} and
// POST /v1/approvals/{id}/decide, plus GET /v1/capabilities/{id} for the expected effect.

export interface Approval {
  readonly approval_id: string;
  readonly capability: string;
  /** The most this call can cost, micro-USD. */
  readonly price_micro: number;
  /** The call's body, exactly as it was sent. */
  readonly input?: unknown;
  readonly requested_by: { readonly kind: string; readonly act?: string; readonly member_id?: string };
  readonly created_at: string;
  readonly expires_at: string;
}

export interface ApprovalJob {
  readonly job_id: string;
  readonly status: "running" | "done" | "failed" | "cancelled";
  readonly approval?: { readonly status: string; readonly decided_by?: string };
  readonly result?: unknown;
  readonly error?: { readonly code: string; readonly message: string };
}

export type ApprovalState = "pending" | "approved" | "denied" | "expired" | "cancelled";

export interface ApprovalDetail extends Approval {
  readonly job: ApprovalJob;
  readonly state: ApprovalState;
  /** What running it does, from the capability's own description. */
  readonly effect?: { readonly description: string; readonly irreversible: boolean };
}

export interface ApprovalList {
  readonly results: Approval[];
  readonly viewer: Viewer;
}

export function stateOf(a: Approval, job: ApprovalJob | undefined, now = Date.now()): ApprovalState {
  const s = job?.approval?.status;
  if (s === "approved" || s === "denied" || s === "expired" || s === "cancelled") return s;
  if (job?.status === "cancelled") return "cancelled";
  return Date.parse(a.expires_at) <= now ? "expired" : "pending";
}

export async function listApprovals(request: Request): Promise<ApprovalList> {
  const viewer = await currentViewer(request);
  const { results } = await pramaan<{ results: Approval[] }>("/v1/approvals", { headers: asViewer(viewer) });
  return { results, viewer };
}

export async function getApproval(request: Request, id: string): Promise<{ approval: ApprovalDetail; viewer: Viewer }> {
  const viewer = await currentViewer(request);
  const a = await pramaan<Approval & { job: ApprovalJob }>(`/v1/approvals/${encodeURIComponent(id)}`, {
    headers: asViewer(viewer),
  });
  // The effect is extra context: an approval still shows if its capability can't be described.
  const info = await pramaan<{ description: string; effect_class: string }>(
    `/v1/capabilities/${encodeURIComponent(a.capability)}`,
  ).catch(() => undefined);
  return {
    approval: {
      ...a,
      state: stateOf(a, a.job),
      ...(info ? { effect: { description: info.description, irreversible: info.effect_class.includes("irreversible") } } : {}),
    },
    viewer,
  };
}

export async function decideApproval(request: Request, id: string) {
  const viewer = await currentViewer(request);
  if (!viewer.canApprove || !viewer.memberId)
    throw new PramaanError("forbidden", "Only an approver can decide this. Ask an approver in your workspace.", { status: 403 });
  const body = (await request.json().catch(() => undefined)) as { decision?: unknown } | undefined;
  const decision = body?.decision;
  if (decision !== "approve" && decision !== "deny")
    throw new PramaanError("invalid_request", "Choose approve or decline.", { status: 400 });
  // One key per decision. The API also refuses a second decision with 409 conflict.
  const key = request.headers.get("Idempotency-Key") ?? crypto.randomUUID();
  return pramaan<{ approval_id: string; status: string; job: ApprovalJob }>(
    `/v1/approvals/${encodeURIComponent(id)}/decide`,
    { method: "POST", body: { decision }, headers: { ...asViewer(viewer), "Idempotency-Key": key } },
  );
}
