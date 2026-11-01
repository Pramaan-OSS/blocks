"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/pramaan/confirm-action";
import { InputFields } from "@/components/pramaan/fields";
import { EmptyState, ErrorState, LoadingState } from "@/components/pramaan/states";
import { ApiError, announceChange, api, formatMicro, useResource } from "@/lib/pramaan/client";
import { actionName } from "@/lib/pramaan/plain";
import type { MissionDetail, MissionEstimate, MissionInfo, MissionJob } from "@/lib/pramaan/missions";
import { MissionJobView } from "./job-view";
import { buildInput, type FormValues, SchemaForm } from "@/components/pramaan/schema-form";

const storeKey = (k: string) => `pramaan:mission-job:${k}`;

/**
 * Start a mission, watch its steps, see the result and the cost.
 *
 * - `missionId`: a fixed mission; leave it out to show a picker.
 * - `onResult`: called once with the finished job.
 * - `approvalsHref`: where the approvals inbox lives, for steps that wait for a yes.
 * - `walletHref`: where the wallet block lives; a refusal for low credit links there (else to the API's own link).
 * - `storageKey`: one browser remembers one run per key, so a reload reattaches to it.
 */
export function MissionRunner({
  missionId,
  onResult,
  approvalsHref,
  walletHref,
  storageKey = missionId ?? "any",
  pollMs,
}: {
  missionId?: string;
  onResult?: (job: MissionJob) => void;
  approvalsHref?: string;
  walletHref?: string;
  storageKey?: string;
  pollMs?: number;
}) {
  const picker = useId();
  const list = useResource<{ results: MissionInfo[] }>(missionId ? null : "/api/pramaan/missions");
  const [picked, setPicked] = useState("");
  const id = missionId ?? picked;
  const mission = useResource<MissionDetail>(id ? `/api/pramaan/missions/${encodeURIComponent(id)}` : null);

  const [values, setValues] = useState<FormValues>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [estimate, setEstimate] = useState<MissionEstimate>();
  const [estimating, setEstimating] = useState(false);
  const [problem, setProblem] = useState<ApiError>();
  const [input, setInput] = useState<Record<string, unknown>>({});

  // A run this browser started: remembered so a reload shows the same run.
  const [jobId, setJobId] = useState<string>();
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    setJobId(localStorage.getItem(storeKey(storageKey)) ?? undefined);
    setRestored(true);
  }, [storageKey]);
  // One key per click on Start: a repeat of the same request returns the same run.
  const startKey = useRef("");
  useEffect(() => {
    startKey.current = crypto.randomUUID();
  }, [jobId]);

  function forget() {
    localStorage.removeItem(storeKey(storageKey));
    setJobId(undefined);
    setEstimate(undefined);
  }

  async function getEstimate() {
    if (!mission.data) return;
    const built = buildInput(mission.data.input_schema, values);
    setErrors(built.errors);
    setProblem(undefined);
    setEstimate(undefined);
    if (Object.keys(built.errors).length) return;
    setEstimating(true);
    try {
      setInput(built.input);
      setEstimate(await api<MissionEstimate>(`/api/pramaan/missions/${encodeURIComponent(mission.data.id)}/estimate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: built.input }),
      }));
    } catch (e) {
      setProblem(e as ApiError);
    } finally {
      setEstimating(false);
    }
  }

  async function start() {
    if (!mission.data || !estimate) return;
    try {
      const started = await api<{ job_id: string }>(`/api/pramaan/missions/${encodeURIComponent(mission.data.id)}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": startKey.current },
        body: JSON.stringify({ input, plan: estimate.plan }),
      });
      localStorage.setItem(storeKey(storageKey), started.job_id);
      setJobId(started.job_id);
      announceChange();
    } catch (e) {
      setProblem(e as ApiError);
    }
  }

  if (!restored) return <LoadingState label="Loading" />;

  if (jobId)
    return <MissionJobView jobId={jobId} steps={mission.data?.steps} approvalsHref={approvalsHref} pollMs={pollMs} onResult={onResult} onNewRun={forget} />;

  const detail = mission.data;
  return (
    <div className="space-y-5">
      {!missionId && (
        <div className="space-y-1.5">
          <label htmlFor={picker} className="text-sm font-medium">Mission</label>
          {list.error ? (
            <ErrorState error={list.error} onRetry={list.reload} />
          ) : !list.data ? (
            <LoadingState label="Loading missions" />
          ) : (
            <select
              id={picker}
              value={picked}
              onChange={(e) => {
                setPicked(e.target.value);
                setValues({});
                setEstimate(undefined);
                setErrors({});
              }}
              className="pr-select"
            >
              <option value="">Choose a mission…</option>
              {list.data.results.filter((m) => m.available).map((m) => (
                <option key={m.id} value={m.id}>
                  {actionName(m.id)} — up to {formatMicro(m.price_max_micro)}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {!id ? (
        !missionId && list.data && <EmptyState title="Choose a mission">Its inputs, steps and price show here.</EmptyState>
      ) : mission.error ? (
        <ErrorState error={mission.error} onRetry={mission.reload} />
      ) : !detail ? (
        <LoadingState label="Loading the mission" />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{detail.description}</p>
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              void getEstimate();
            }}
          >
            <SchemaForm
              schema={detail.input_schema}
              values={values}
              errors={errors}
              onChange={(v) => {
                setValues(v);
                setEstimate(undefined);
              }}
            />
            <Button type="submit" disabled={estimating}>
              {estimating ? "Getting the estimate…" : "Get estimate"}
            </Button>
          </form>

          {problem && <ErrorState error={problem} walletHref={walletHref} />}

          {estimate && (
            <section aria-label="Estimate" className="pr-card space-y-3">
              <p className="text-sm">
                This run costs at most <strong>{formatMicro(estimate.price_max_micro)}</strong>. You are charged for the steps that run.
              </p>
              <ul className="space-y-1 text-sm">
                {estimate.steps.map((s) => (
                  <li key={s.id} className="flex justify-between gap-3">
                    <span>
                      {s.label}
                      {s.requires_approval && <span className="text-muted-foreground"> — needs a person’s approval</span>}
                    </span>
                    <span className="text-muted-foreground">up to {formatMicro(s.price_max_micro)}</span>
                  </li>
                ))}
              </ul>
              {!estimate.ready && <p role="alert" className="text-sm text-destructive">{estimate.message ?? "Something is still missing before this can run."}</p>}
              {estimate.top_up && (
                <ErrorState error={new ApiError(estimate.top_up.message, "spend_cap_reached", undefined, 402, { ...estimate.top_up, links: [...estimate.top_up.links] })} walletHref={walletHref} />
              )}
              <ConfirmAction
                label="Start"
                title={`${actionName(detail.id)}?`}
                description={`It runs once and costs at most ${formatMicro(estimate.price_max_micro)}.`}
                details={<InputFields input={input} label="Exact inputs" empty="This run needs no input." />}
                disabled={!estimate.ready || !estimate.can_run}
                onConfirm={start}
              />
            </section>
          )}
        </>
      )}
    </div>
  );
}
