import "server-only";
import { PramaanError } from "@pramaan/sdk";
import type { JsonSchema } from "@/lib/pramaan/json-schema";
import { pramaan, type TopUp } from "@/lib/pramaan/server";

// Server half of the mission runner: GET /v1/outcomes, GET /v1/outcomes/{id},
// POST /v1/outcomes/{id}/estimate, POST /v1/outcomes/{id}, GET /v1/jobs/{id} and
// POST /v1/jobs/{id}/cancel. A "mission" is the product name for an outcome.

export interface MissionInfo {
  readonly id: string;
  readonly description: string;
  readonly effect_class: string;
  readonly mode: "sync" | "async";
  /** The most one run can cost, micro-USD. */
  readonly price_max_micro: number;
  readonly requires_approval?: true;
  readonly available: boolean;
}

export interface MissionStep {
  readonly id: string;
  readonly label: string;
  readonly capability: string;
  readonly effect_class: string;
  readonly requires_approval: boolean;
  readonly price_max_micro: number;
}

export interface MissionDetail extends MissionInfo {
  /** JSON Schema of the input the run takes. */
  readonly input_schema: JsonSchema;
  readonly steps: readonly MissionStep[];
}

export type { JsonSchema };

export interface MissionEstimate {
  readonly outcome: string;
  /** The plan this estimate names. A run that needs approval sends it back. Good for 15 minutes. */
  readonly plan: string;
  /** False while an input or a connection is still missing. */
  readonly ready: boolean;
  readonly can_run: boolean;
  readonly price_max_micro: number;
  readonly steps: readonly MissionStep[];
  readonly message?: string;
  readonly top_up?: TopUp;
  readonly connect_url?: string;
}

export type StepStatus = "waiting" | "running" | "waiting_approval" | "done" | "failed" | "skipped";

/** A run of a mission, as GET /v1/jobs/{id} answers. `progress` is not in the OpenAPI yet. */
export interface MissionJob {
  readonly job_id: string;
  readonly capability: string;
  readonly status: "running" | "done" | "failed" | "cancelled";
  /** The run report once the job has ended. */
  readonly result?: {
    readonly status?: string;
    readonly result?: unknown;
    readonly steps?: readonly { readonly id: string; readonly status: string; readonly capability?: string }[];
    readonly cost?: { readonly hold_micro: number; readonly charged_micro: number };
  };
  readonly error?: { readonly code: string; readonly message: string };
  readonly progress?: {
    readonly steps: readonly { readonly id: string; readonly label?: string; readonly status: StepStatus; readonly approval_id?: string }[];
    readonly charged_micro: number;
  };
  readonly created_at: string;
  readonly updated_at: string;
}

export const listMissions = () => pramaan<{ results: MissionInfo[] }>("/v1/outcomes");

export const getMission = (id: string) => pramaan<MissionDetail>(`/v1/outcomes/${encodeURIComponent(id)}`);

export function estimateMission(id: string, body: { input?: unknown; options?: unknown }) {
  return pramaan<MissionEstimate>(`/v1/outcomes/${encodeURIComponent(id)}/estimate`, {
    method: "POST",
    body: { input: body.input ?? {}, ...(body.options ? { options: body.options } : {}) },
  });
}

/**
 * Starts a run. `key` is the person's one click: a retry with the same key returns the same job,
 * so a double click never starts two. `plan` is the plan from the estimate they saw.
 */
export function startMission(id: string, body: { input?: unknown; options?: unknown; plan?: unknown }, key: string) {
  if (body.plan !== undefined && typeof body.plan !== "string")
    throw new PramaanError("invalid_request", "The price has changed. Check it again, then run.", { status: 400 });
  return pramaan<{ job_id: string; status: "running"; held_micro: number }>(`/v1/outcomes/${encodeURIComponent(id)}`, {
    method: "POST",
    body: { input: body.input ?? {}, ...(body.options ? { options: body.options } : {}) },
    headers: { "Idempotency-Key": key, ...(body.plan ? { "Pramaan-Plan": body.plan } : {}) },
  });
}

export const getJob = (id: string) => pramaan<MissionJob>(`/v1/jobs/${encodeURIComponent(id)}`);

export const cancelJob = (id: string) => pramaan<MissionJob>(`/v1/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST" });
