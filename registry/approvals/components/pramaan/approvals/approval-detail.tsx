"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmAction } from "@/components/pramaan/confirm-action";
import { CopyReference, InputFields } from "@/components/pramaan/fields";
import { StatusPill } from "@/components/pramaan/parts";
import { ErrorState, LoadingState, StatusMessage, type StatusTone } from "@/components/pramaan/states";
import { announceChange, api, type ApiError, atMost, formatMicro, useNow, useResource } from "@/lib/pramaan/client";
import { actionName, formatDate, requesterLabel } from "@/lib/pramaan/plain";
import type { ApprovalDetail as Detail, ApprovalState } from "@/lib/pramaan/approvals";
import type { Viewer } from "@/lib/pramaan/server";
import { rememberDecision } from "./history";

const STATE_LABEL: Record<ApprovalState, string> = {
  pending: "Waiting",
  approved: "Approved",
  denied: "Declined",
  expired: "Expired",
  cancelled: "Cancelled",
};

const STATE_NOTE: Record<Exclude<ApprovalState, "pending">, string> = {
  approved: "This was approved. It runs once and can't be approved again.",
  denied: "This was declined, so nothing ran and nothing was charged.",
  expired: "Nobody approved this in time, so nothing ran. It can't be approved now; ask for it to be sent again.",
  cancelled: "This was cancelled, so nothing ran.",
};

export function StateBadge({ state }: { state: ApprovalState }) {
  return <StatusPill tone={state === "pending" ? "amber" : state === "approved" ? "green" : "grey"}>{STATE_LABEL[state]}</StatusPill>;
}

const when = (iso: string) => formatDate(iso);

/** One approval: exact inputs, expected effect, maximum price, and Approve / Decline for approvers. */
export function ApprovalDetail({
  id,
  viewer,
  onDecided,
}: {
  id: string;
  viewer: Viewer;
  onDecided?: (id: string, decision: "approve" | "deny") => void;
}) {
  const { data, error, reload } = useResource<{ approval: Detail }>(`/api/pramaan/approvals/${encodeURIComponent(id)}`);
  const now = useNow();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; tone: StatusTone }>();

  async function decide(decision: "approve" | "deny") {
    setBusy(true);
    setStatus({ text: decision === "approve" ? "Approving…" : "Declining…", tone: "info" });
    try {
      await api(`/api/pramaan/approvals/${encodeURIComponent(id)}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ decision }),
      });
      rememberDecision(id, decision, data?.approval.capability);
      setStatus(
        decision === "approve"
          ? { text: "Approved. The call runs once.", tone: "success" }
          : { text: "Declined. Nothing ran and nothing was charged.", tone: "success" },
      );
      onDecided?.(id, decision);
    } catch (e) {
      const err = e as ApiError;
      setStatus({ text: err.status === 409 ? `Already decided. ${err.message}` : err.message, tone: "error" });
    } finally {
      setBusy(false);
      announceChange();
      reload();
    }
  }

  if (!data) return error ? <ErrorState error={error} onRetry={reload} /> : <LoadingState label="Loading this request" />;
  const a = data.approval;
  const state: ApprovalState = a.state === "pending" && now > 0 && Date.parse(a.expires_at) <= now ? "expired" : a.state;
  const price = formatMicro(a.price_micro);
  const inputs = <InputFields input={a.input ?? {}} label="What it will use" />;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-base">{actionName(a.capability)}</CardTitle>
          <StateBadge state={state} />
        </div>
        {a.effect && <CardDescription>{a.effect.description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Asked by</dt>
          <dd>{requesterLabel(a.requested_by)}</dd>
          <dt className="text-muted-foreground">Asked at</dt>
          <dd>{when(a.created_at)}</dd>
          <dt className="text-muted-foreground">Expires</dt>
          <dd>{when(a.expires_at)}</dd>
          <dt className="text-muted-foreground">Maximum price</dt>
          <dd>{price}</dd>
          <dt className="text-muted-foreground">Reference</dt>
          <dd>
            <CopyReference value={a.approval_id} />
          </dd>
        </dl>
        {a.effect?.irreversible && <p className="text-sm font-medium">This can&apos;t be undone once it runs.</p>}
        <div className="space-y-1">
          <h3>What it will use</h3>
          {inputs}
        </div>

        {state === "pending" && viewer.canApprove ? (
          <div className="flex gap-2">
            <ConfirmAction
              label="Approve"
              title={`${actionName(a.capability)}?`}
              description={`It runs once, exactly as shown, and costs ${atMost(a.price_micro)}.`}
              details={inputs}
              disabled={busy}
              onConfirm={() => decide("approve")}
            />
            <ConfirmAction
              label="Decline"
              title={`Decline: ${actionName(a.capability).toLowerCase()}?`}
              description="Nothing runs and nothing is charged."
              variant="outline"
              disabled={busy}
              onConfirm={() => decide("deny")}
            />
          </div>
        ) : state === "pending" ? (
          <p className="text-sm text-muted-foreground">Read only: only an approver can decide this.</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {state === "approved" && a.job.status === "failed" && a.job.error ? a.job.error.message : STATE_NOTE[state]}
          </p>
        )}
        <StatusMessage text={status?.text} tone={status?.tone} />
      </CardContent>
    </Card>
  );
}
