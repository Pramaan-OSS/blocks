"use client";

import { useCallback, useEffect, useState } from "react";
import { plainProblem } from "./plain";

// Browser half of the shared Pramaan helpers: calls this app's own /api/pramaan routes, never
// Pramaan itself, so no key is needed here.

/** An error from this app's API, with the server's own message and next step. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly next?: string,
    readonly status?: number,
    /** Present on a low-balance refusal: where to add credit. */
    readonly topUp?: { message: string; links: { label: string; url: string }[]; balance_micro: number },
  ) {
    super(message);
  }
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store", ...init });
  } catch {
    throw new ApiError("Can't reach the server. Check your connection and try again.", "network");
  }
  const data = await res.json().catch(() => undefined);
  if (!res.ok) {
    const e = data?.error ?? {};
    const p = plainProblem(e.code ?? "internal", res.status, e.message ?? "", e.next);
    throw new ApiError(p.message, e.code ?? "internal", p.next, res.status, e.top_up);
  }
  return data as T;
}

/** Micro-USD as dollars to 2 decimals: 905219 -> "$0.91". */
export function formatMicro(micro: number): string {
  if (micro > 0 && micro < 5_000) return "under $0.01";
  return `$${(micro / 1_000_000).toFixed(2)}`;
}

/** A most-it-can-cost price as a phrase: "up to $0.12", "$0.01" for a tiny price, "free" for none. Never "up to under". */
export const upTo = (micro: number) => (micro === 0 ? "free" : micro < 5_000 ? formatMicro(micro) : `up to ${formatMicro(micro)}`);

/** The same for a sentence about cost: "at most $0.12", "less than $0.01", "nothing". */
export const atMost = (micro: number) => (micro === 0 ? "nothing" : micro < 5_000 ? "less than $0.01" : `at most ${formatMicro(micro)}`);

/** Tell every block on the page that Pramaan data changed (they reload). */
export const PRAMAAN_CHANGED = "pramaan:changed";
export const announceChange = () => window.dispatchEvent(new Event(PRAMAAN_CHANGED));

/** GETs a URL, optionally every `pollMs`, and again on `announceChange()`. */
export function useResource<T>(url: string | null, pollMs?: number) {
  const [state, setState] = useState<{ data?: T; error?: ApiError; loading: boolean }>({ loading: url !== null });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!url) return;
    let live = true;
    const load = () =>
      api<T>(url).then(
        (data) => live && setState({ data, loading: false }),
        (error: ApiError) => live && setState((s) => ({ data: s.data, error, loading: false })),
      );
    void load();
    const timer = pollMs ? setInterval(load, pollMs) : undefined;
    window.addEventListener(PRAMAAN_CHANGED, load);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener(PRAMAAN_CHANGED, load);
    };
  }, [url, pollMs, tick]);

  return { ...state, reload };
}

/**
 * The current time, refreshed every `everyMs`, so expiry shows without a reload. It is 0 until
 * the page mounts: reading the clock while rendering breaks prerendering.
 */
export function useNow(everyMs = 1_000): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}
