"use client";

import { useEffect, useRef, useState } from "react";
import { ConfirmAction } from "@/components/pramaan/confirm-action";
import { InputFields } from "@/components/pramaan/fields";
import { StatusPill, type PillTone } from "@/components/pramaan/parts";
import { ErrorState, LoadingState, StatusMessage, type StatusTone } from "@/components/pramaan/states";
import { ApiError, announceChange, api, formatMicro, useResource } from "@/lib/pramaan/client";
import type { MissionJob, MissionStep, StepStatus } from "@/lib/pramaan/missions";

const STATUS_TEXT: Record<StepStatus, string> = {
  waiting: "Waiting",
  running: "Running",
  waiting_approval: "Waiting for approval",
  done: "Done",
  failed: "Failed",
  skipped: "Not run",
};
const TONE: Record<StepStatus, PillTone> = { waiting: "grey", running: "blue", waiting_approval: "amber", done: "green", failed: "red", skipped: "grey" };

/** What the run has cost so far: its report once it ended, else the charge its progress shows. */
export const chargedOf = (j: MissionJob) => j.result?.cost?.charged_micro ?? j.progress?.charged_micro ?? 0;

type Row = { id: string; label: string; status: StepStatus; approvalId?: string };

/** The job's own progress when it reports it, else the mission's steps with what the report says. */
function rowsOf(job: MissionJob, planned: readonly MissionStep[] = []): Row[] {
  if (job.progress) return job.progress.steps.map((s) => ({ id: s.id, label: s.label ?? s.id, status: s.status, approvalId: s.approval_id }));
  const ended = job.status !== "running";
  const ok = new Set((job.result?.steps ?? []).filter((s) => s.status === "ok").map((s) => s.id));
  return planned.map((s) => ({
    id: s.id,
    label: s.label,
    status: ended ? (ok.has(s.id) || job.status === "done" ? "done" : "skipped") : "running",
  }));
}

/**
 * One run of a mission: step timeline, cost so far, Cancel, and the result. It polls while the run
 * is going and stops when it ends. A step that waits for a yes is handed to the approvals inbox
 * (`approvalsHref`); the run goes on by itself after the decision.
 */
export function MissionJobView({
  jobId,
  steps,
  approvalsHref = "/",
  pollMs = 2_000,
  onResult,
  onNewRun,
}: {
  jobId: string;
  /** The mission's steps, shown when the job reports no progress of its own. */
  steps?: readonly MissionStep[];
  approvalsHref?: string;
  pollMs?: number;
  onResult?: (job: MissionJob) => void;
  /** Offered once the run ended (or can't be found): start another. */
  onNewRun?: () => void;
}) {
  const [live, setLive] = useState(true);
  const job = useResource<MissionJob>(`/api/pramaan/jobs/${encodeURIComponent(jobId)}`, live ? pollMs : undefined);
  const data = job.data;
  useEffect(() => {
    if ((data && data.status !== "running") || (job.error && !data)) setLive(false);
  }, [data, job.error]);

  const reported = useRef<string>(undefined);
  useEffect(() => {
    if (data?.status === "done" && reported.current !== data.job_id) {
      reported.current = data.job_id;
      onResult?.(data);
    }
  }, [data, onResult]);

  const [note, setNote] = useState<{ text: string; tone: StatusTone }>();
  const holdMicro = data?.result?.cost?.hold_micro;

  async function cancel() {
    try {
      const ended = await api<MissionJob>(`/api/pramaan/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" });
      setNote({ text: `Cancelled. You were charged ${formatMicro(chargedOf(ended))} for the work already done.`, tone: "success" });
      setLive(false);
      job.reload();
      announceChange();
    } catch (e) {
      setNote({ text: e instanceof ApiError ? e.message : "Couldn't cancel. Try again.", tone: "error" });
    }
  }

  if (!data) {
    return job.error ? (
      <div className="space-y-3">
        <ErrorState error={job.error} onRetry={() => { setLive(true); job.reload(); }} />
        {onNewRun && <button type="button" className="text-sm underline" onClick={onNewRun}>Start a new run</button>}
      </div>
    ) : (
      <LoadingState label="Loading the run" />
    );
  }

  const rows = rowsOf(data, steps);
  const current = rows.findIndex((r) => r.status !== "done");
  const waiting = rows.find((r) => r.status === "waiting_approval");
  const headline =
    data.status === "done"
      ? "Finished."
      : data.status === "cancelled"
        ? "Cancelled."
        : data.status === "failed"
          ? `Failed: ${data.error?.message ?? "the run did not finish."}`
          : current >= 0
            ? `Step ${current + 1} of ${rows.length}: ${rows[current].label}. ${STATUS_TEXT[rows[current].status]}.`
            : "Working.";

  return (
    <div className="space-y-4">
      <StatusMessage text={note?.text ?? headline} tone={note?.tone ?? (data.status === "failed" ? "error" : "info")} />

      <ol aria-label="Steps" className="pr-rows">
        {rows.map((r) => (
          <li key={r.id} className="pr-row text-sm" data-status={r.status}>
            <span className="pr-row-main">
              <b>{r.label}</b>
            </span>
            <span className="pr-row-side">
              <StatusPill tone={TONE[r.status]}>{STATUS_TEXT[r.status]}</StatusPill>
            </span>
          </li>
        ))}
      </ol>

      {waiting && (
        <p role="note" className="rounded-md bg-muted p-3 text-sm">
          “{waiting.label}” needs a person’s yes. <a className="underline" href={approvalsHref}>Open the approvals inbox</a>; the run continues after the decision.
        </p>
      )}

      <p className="text-sm">
        {data.status === "running" ? "Cost so far: " : "Cost: "}
        <strong>{formatMicro(chargedOf(data))}</strong>
        {data.status === "running" && holdMicro === undefined && <span className="text-muted-foreground"> (the estimate stays set aside until the run ends)</span>}
      </p>

      {data.status === "running" && (
        <ConfirmAction
          label="Cancel run"
          title="Cancel this run?"
          description="No new step starts. You pay only for the work already done, never more than the estimate, and the rest of the credit set aside comes back."
          confirmLabel="Cancel run"
          variant="destructive"
          onConfirm={cancel}
        />
      )}

      {data.status === "done" && (
        <section aria-label="Result" className="space-y-2">
          <h3>Result</h3>
          <InputFields input={data.result?.result} label="What came back" empty="The run finished with nothing to show." />
        </section>
      )}
      {data.status === "failed" && data.error && (
        <div role="alert" className="pr-card border-destructive/50 text-sm">
          <p className="font-medium text-destructive">{data.error.message}</p>
        </div>
      )}
      {data.status !== "running" && onNewRun && (
        <button type="button" className="rounded text-sm underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={onNewRun}>
          Start another run
        </button>
      )}
    </div>
  );
}
