import "server-only";
import { PramaanError } from "@pramaan/sdk";
import { asViewer, capability, currentViewer, pramaan, signedOut } from "@/lib/pramaan/server";
import { currentEndUserRef } from "@/lib/pramaan/session";

// Server half of the memory viewer. A person's own memories come from the memory.* superpowers
// (items.list, items.search, item.delete, scope.delete, history.list). Organisation memories come
// from the workspace's review queue. The person is always the signed-in one (see
// lib/pramaan/session.ts): the browser never names whose memories to read, so an admin can't open
// someone else's.

export interface Memory {
  /** The handle for deleting this memory. Never shown. */
  readonly ref: string;
  readonly text: string;
  readonly createdAt?: string;
}

export interface MemoryPage {
  readonly results: Memory[];
  readonly nextCursor?: string;
}

export interface Change {
  readonly ref?: string;
  readonly event: "add" | "update" | "delete";
  readonly text?: string;
  readonly oldText?: string;
  readonly createdAt?: string;
}

export interface OrgQueue {
  /** False for anyone who isn't a workspace admin: the screen explains and shows nothing. */
  readonly admin: boolean;
  readonly rows: { id: string; text: string; conflict: boolean }[];
  readonly notices: { id: string; text: string; promotedAt?: string }[];
}

const bad = (message: string, status = 400) => new PramaanError("invalid_request", message, { status });

// A reference from a list row, or from the call that stored the memory.
const REF = /^(ref_[0-9A-HJKMNP-TV-Z]{26}|rh_[A-Za-z0-9_-]{24,1024})$/;

const namespace = () => process.env.PRAMAAN_MEMORY_NAMESPACE || "assistant";

async function scope(request: Request) {
  const ref = await currentEndUserRef(request);
  if (!ref) throw signedOut("What is remembered about you shows here once you're signed in.");
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(ref))
    throw bad("Your sign-in couldn't be read. Ask whoever runs this app to check its setup.", 500);
  return { namespace: namespace(), user: ref };
}

/** The person's own memories, newest first; `q` searches them. */
export async function listMemories(request: Request, q: string | null, cursor: string | null, limit = 10): Promise<MemoryPage> {
  const s = await scope(request);
  const paging = { limit, ...(cursor ? { cursor } : {}) };
  const query = q?.trim();
  if (query) {
    if (query.length > 2000) throw bad("Search for up to 2000 characters.");
    return capability<MemoryPage>("memory.items.search", { scope: s, query, ...paging });
  }
  return capability<MemoryPage>("memory.items.list", { scope: s, ...paging });
}

/** What changed in the person's memories, newest first. */
export async function listChanges(request: Request, cursor: string | null): Promise<{ results: Change[]; nextCursor?: string }> {
  return capability("memory.history.list", { scope: await scope(request), limit: 20, ...(cursor ? { cursor } : {}) });
}

const waiting = (res: { status?: string }) => res.status === "running";

/** Deletes one memory for good. The API holds an irreversible call for a member's approval: 202 means it waits in the inbox. */
export async function deleteMemory(request: Request, ref: string) {
  if (!REF.test(ref)) throw bad("That memory reference isn't valid. Reload the list and try again.");
  const s = await scope(request);
  const res = await capability<{ deleted?: boolean; status?: string }>("memory.item.delete", { ref, confirm: true, scope: s });
  return waiting(res) ? { status: "waiting_for_approval" as const } : { status: "deleted" as const };
}

/** Forgets everything remembered about the signed-in person. Waits for approval like a single delete. */
export async function forgetEverything(request: Request) {
  const res = await capability<{ deletedCount?: number; status?: string }>("memory.scope.delete", { scope: await scope(request), confirm: true });
  return waiting(res) ? { status: "waiting_for_approval" as const } : { status: "forgotten" as const, count: res.deletedCount ?? 0 };
}

async function adminViewer(request: Request) {
  const viewer = await currentViewer(request);
  if (!viewer.memberId) return undefined;
  const { results } = await pramaan<{ results: { member_id: string; role: string }[] }>("/v1/members");
  const role = results.find((m) => m.member_id === viewer.memberId)?.role;
  return role === "owner" || role === "admin" ? viewer : undefined;
}

export async function orgQueue(request: Request): Promise<OrgQueue> {
  const viewer = await adminViewer(request);
  if (!viewer) return { admin: false, rows: [], notices: [] };
  const q = await pramaan<Omit<OrgQueue, "admin">>("/v1/memory/admin/queue", { headers: asViewer(viewer) });
  return { admin: true, rows: q.rows, notices: q.notices };
}

const ACTIONS = ["approve", "reject", "remove", "acknowledge"] as const;

export async function decideOrg(request: Request, body: { id?: unknown; action?: unknown }) {
  const viewer = await adminViewer(request);
  if (!viewer) throw new PramaanError("forbidden", "Only workspace admins can manage organisation memory. Ask an admin to sign in.", { status: 403 });
  if (typeof body.id !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(body.id)) throw bad("Choose a memory to decide.");
  if (!ACTIONS.includes(body.action as (typeof ACTIONS)[number])) throw bad("Choose approve, reject, remove or acknowledge.");
  return pramaan<{ ok: true }>("/v1/memory/admin/decide", { method: "POST", body: { id: body.id, action: body.action }, headers: asViewer(viewer) });
}

/** Member facts use the workspace member identity, not the app's end-user reference. */
export async function memberProfile(request: Request) {
  const viewer = await currentViewer(request);
  if (!viewer.memberId) throw signedOut("Sign in to see what is remembered about you.");
  return capability<{ facts: { id: string; text: string }[] }>("memory.member.profile.get", { scope: { user: viewer.memberId } }, asViewer(viewer));
}
