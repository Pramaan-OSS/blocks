import "server-only";
import { PramaanError } from "@pramaan/sdk";
import type { JsonSchema } from "@/lib/pramaan/json-schema";
import { actionName } from "@/lib/pramaan/plain";
import { capability, pramaan, type TopUp } from "@/lib/pramaan/server";

// Server half of the superpower picker: search single actions ("superpowers") and missions in plain
// words, describe one, estimate it and run it. Calls GET /v1/capabilities?query=, GET
// /v1/capabilities/{id}, POST /v1/capabilities/{id}/estimate, POST /v1/capabilities/{id}, and for
// missions GET /v1/outcomes and GET /v1/outcomes/{id}.

export type Kind = "action" | "mission";

export interface Choice {
  readonly id: string;
  readonly kind: Kind;
  /** The plain name: "Send a text message". */
  readonly name: string;
  readonly description: string;
  /** The most one use can cost, micro-USD. */
  readonly priceMicro: number;
  readonly needsApproval: boolean;
  /** True when the action needs a connected account first. */
  readonly needsConnection: boolean;
}

export interface Clarify {
  readonly question: string;
  readonly options: readonly { id: string; label: string }[];
}

export interface SearchResult {
  readonly results: Choice[];
  /** One question to ask when the words fit several actions about equally. */
  readonly clarify?: Clarify;
  /** Words nothing matched, for a near miss. */
  readonly missed?: string[];
  /** More matches exist than are shown. */
  readonly more: boolean;
}

export interface Detail extends Choice {
  readonly inputSchema: JsonSchema;
  readonly steps?: readonly { label: string; needsApproval: boolean; priceMicro: number }[];
}

export interface Estimate {
  readonly priceMaxMicro: number;
  readonly ready: boolean;
  readonly canRun: boolean;
  readonly message?: string;
  readonly topUp?: TopUp;
}

export type RunResult = { readonly status: "done"; readonly result: unknown } | { readonly status: "waiting_for_approval" } | { readonly status: "running" };

interface CapRow {
  id: string;
  description: string;
  price_micro: number;
  price_estimate_micro?: number;
  available?: boolean;
  needs_connection?: boolean;
  requires_approval?: boolean;
  search_hidden?: boolean;
  request_schema?: JsonSchema;
}

interface MissionRow {
  id: string;
  description: string;
  price_micro: number;
  needs_connection?: boolean;
  price_max_micro?: number;
  available?: boolean;
  requires_approval?: boolean;
  input_schema?: JsonSchema;
  steps?: { label: string; requires_approval: boolean; price_max_micro: number }[];
}

const ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const SHOWN = 20;

const bad = (message: string) => new PramaanError("invalid_request", message, { status: 400 });
const idOf = (id: string) => {
  if (!ID.test(id)) throw bad("That action isn't valid. Search again and choose one from the list.");
  return id;
};

const fromCap = (r: CapRow): Choice => ({
  id: r.id,
  kind: "action",
  name: actionName(r.id),
  description: r.description,
  priceMicro: r.price_micro,
  needsApproval: r.requires_approval === true,
  needsConnection: r.needs_connection === true,
});

const fromMission = (r: MissionRow): Choice => ({
  id: r.id,
  kind: "mission",
  name: actionName(r.id),
  description: r.description,
  priceMicro: r.price_micro,
  needsApproval: r.requires_approval === true,
  needsConnection: r.needs_connection === true,
});

/** Search in plain words. Nothing is offered that can't run now. */
export async function searchChoices(q: string | null): Promise<SearchResult> {
  const query = q?.trim() ?? "";
  if (query.length > 500) throw bad("Search for up to 500 characters.");
  const [caps, outcomes] = await Promise.all([
    pramaan<{ results: CapRow[]; clarify?: Clarify; near_misses?: { missed?: string[] }[] }>(`/v1/capabilities${query ? `?query=${encodeURIComponent(query)}` : ""}`),
    pramaan<{ results: MissionRow[] }>(`/v1/outcomes${query ? `?query=${encodeURIComponent(query)}` : ""}`),
  ]);
  const missions = outcomes.results.filter((m) => m.available !== false);
  const all = [...caps.results.filter((r) => r.available !== false && r.search_hidden !== true).map(fromCap), ...missions.map(fromMission)];
  return {
    results: all.slice(0, SHOWN),
    more: all.length > SHOWN,
    ...(caps.clarify ? { clarify: caps.clarify } : {}),
    ...(all.length === 0 && caps.near_misses?.[0]?.missed ? { missed: caps.near_misses[0].missed } : {}),
  };
}

export async function describeChoice(kind: string, id: string): Promise<Detail> {
  idOf(id);
  if (kind === "mission") {
    const m = await pramaan<MissionRow>(`/v1/outcomes/${encodeURIComponent(id)}`);
    return {
      ...fromMission(m),
      inputSchema: m.input_schema ?? {},
      steps: (m.steps ?? []).map((s) => ({ label: s.label, needsApproval: s.requires_approval, priceMicro: s.price_max_micro })),
    };
  }
  const c = await pramaan<CapRow>(`/v1/capabilities/${encodeURIComponent(id)}`);
  return { ...fromCap(c), inputSchema: c.request_schema ?? {} };
}

export async function estimateChoice(id: string, input: unknown): Promise<Estimate> {
  idOf(id);
  const r = await pramaan<{ price_max_micro: number; can_run: boolean; message?: string; top_up?: TopUp }>(
    `/v1/capabilities/${encodeURIComponent(id)}/estimate`,
    { method: "POST", body: input ?? {} },
  );
  return {
    priceMaxMicro: r.price_max_micro,
    ready: r.can_run,
    canRun: r.can_run,
    ...(r.message ? { message: r.message } : {}),
    ...(r.top_up ? { topUp: r.top_up } : {}),
  };
}

/**
 * Runs one action. `key` is the person's one click: a repeat with the same key returns the first
 * answer, so a double click never runs it twice. An action that sends something is held for a
 * member's yes: 202 means it waits in the approvals inbox.
 */
export async function runChoice(id: string, input: unknown, key: string): Promise<RunResult> {
  idOf(id);
  const res = await capability<{ status?: string; job_id?: string; approval_id?: string } & Record<string, unknown>>(id, input ?? {}, { "Idempotency-Key": key });
  if (res.status !== "running" || typeof res.job_id !== "string") return { status: "done", result: res };
  // The documented 202: approval_id (an apr_ job) while a person must decide; otherwise an async job.
  return res.approval_id || res.job_id.startsWith("apr_") ? { status: "waiting_for_approval" } : { status: "running" };
}
