import "server-only";
import { DEFAULT_BASE_URL, PramaanError } from "@pramaan/sdk";
import { fakePramaanFetch } from "./fake";
import { plainProblem } from "./plain";
import { currentMemberId } from "./session";

// The one place this app talks to Pramaan. It runs on the server only: PRAMAAN_API_KEY never
// reaches the browser. Blocks call platform routes the SDK has no method for through `pramaan()`.

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export function transport(): { baseUrl: string; apiKey: string; fetch: Fetch } {
  if (process.env.PRAMAAN_FAKE === "1")
    return { baseUrl: "http://pramaan.fake", apiKey: "fake", fetch: fakePramaanFetch };
  const apiKey = process.env.PRAMAAN_API_KEY;
  if (!apiKey)
    throw new PramaanError("connection_required", "Pramaan isn't connected yet.", {
      status: 503,
      next: "Set PRAMAAN_API_KEY on the server, then restart the app.",
    });
  return { baseUrl: process.env.PRAMAAN_BASE_URL || DEFAULT_BASE_URL, apiKey, fetch };
}

export interface PramaanRequest {
  readonly method?: "GET" | "POST" | "PUT" | "DELETE";
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
}

/** Calls a Pramaan route and returns its JSON. A refusal throws PramaanError with the API's own words. */
export async function pramaan<T>(path: string, init: PramaanRequest = {}): Promise<T> {
  const t = transport();
  const res = await t.fetch(`${t.baseUrl}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${t.apiKey}`,
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });
  const data = await res.json().catch(() => undefined);
  if (!res.ok) {
    const e = data?.error ?? {};
    throw Object.assign(
      new PramaanError(e.code ?? "internal", e.message ?? `Pramaan answered ${res.status}.`, {
        status: res.status,
        next: e.next,
        reason: e.reason,
        requestId: e.request_id,
      }),
      // A low-balance refusal carries where to add credit; the wallet block and ErrorState use it.
      e.top_up ? { topUp: e.top_up as TopUp } : {},
    );
  }
  return data as T;
}

/** Where to add credit, from a low-balance refusal. */
export interface TopUp {
  readonly message: string;
  readonly links: readonly { readonly label: string; readonly url: string }[];
  readonly required_micro?: number;
  readonly balance_micro: number;
}

/** Runs one capability (a superpower) by id. Returns its result, or the 202 body when it waits for approval. */
export const capability = <T>(id: string, input: unknown, headers?: Record<string, string>) =>
  pramaan<T>(`/v1/capabilities/${encodeURIComponent(id)}`, { method: "POST", body: input, headers });

/**
 * The shared signed-out refusal for any block that needs a member: the screen shows "Sign in to see
 * this." and `reason` (one plain line for that block) under it.
 */
export const signedOut = (reason: string) => new PramaanError("signed_out" as never, "Sign in to see this.", { status: 401, next: reason });

/** The JSON error the browser half reads. Only plain wording goes out: no keys, headers or status codes. */
export function errorResponse(error: unknown): Response {
  if (error instanceof PramaanError) {
    const { topUp } = error as { topUp?: TopUp };
    const { message, next } = plainProblem(error.code, error.status, error.message, error.next);
    return Response.json(
      { error: { code: error.code, message, ...(next ? { next } : {}), ...(topUp ? { top_up: topUp } : {}) } },
      { status: error.status ?? 500 },
    );
  }
  console.error(error);
  return Response.json(
    { error: { code: "internal", message: "Something went wrong on the server. Try again." } },
    { status: 500 },
  );
}

export interface Viewer {
  /** The signed-in person's Pramaan member_id, when your auth maps them to one. */
  readonly memberId?: string;
  /** Whether Pramaan says they may approve calls now. The UI hides actions; the API still enforces. */
  readonly canApprove: boolean;
}

interface Member {
  readonly member_id: string;
  readonly role: "owner" | "admin" | "member" | "viewer";
  readonly may_approve: boolean;
}

/** Who is looking, resolved on the server from GET /v1/members. Unknown people are read-only. */
export async function currentViewer(request: Request): Promise<Viewer> {
  const memberId = await currentMemberId(request);
  if (!memberId) return { canApprove: false };
  const { results } = await pramaan<{ results: Member[] }>("/v1/members");
  const me = results.find((m) => m.member_id === memberId);
  return me ? { memberId, canApprove: me.may_approve } : { canApprove: false };
}

/** Headers that make a call act as the viewer (`Pramaan-Member`). */
export const asViewer = (viewer: Viewer): Record<string, string> =>
  viewer.memberId ? { "Pramaan-Member": viewer.memberId } : {};
