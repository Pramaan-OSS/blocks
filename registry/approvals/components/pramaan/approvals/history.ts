// History is this app's own decisions, kept in the browser; each row is read back by id.
// Limit: per-browser only. Switch to GET /v1/approvals?status= when the API adds it.

export interface HistoryEntry {
  readonly id: string;
  readonly decision: "approve" | "deny";
  readonly at: string;
  /** What was decided, so the history reads in words and not ids. */
  readonly capability?: string;
}

const KEY = "pramaan.approvals.history";

export function readHistory(): HistoryEntry[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as HistoryEntry[];
  } catch {
    return [];
  }
}

export function rememberDecision(id: string, decision: HistoryEntry["decision"], capability?: string): void {
  const entry = { id, decision, at: new Date().toISOString(), capability };
  localStorage.setItem(KEY, JSON.stringify([entry, ...readHistory().filter((h) => h.id !== id)].slice(0, 50)));
}
