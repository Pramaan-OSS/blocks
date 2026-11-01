import type { FakeCtx, FakeState } from "./fake";

// Fake private memories (memory.* superpowers) and the organisation memory queue, with the documented
// shapes. Extends the core fake. Deleting a memory, or erasing a whole scope, waits for a member's
// approval in the approvals inbox, as an irreversible call made with a key does, and takes effect
// once it is approved.
//
// Not in the OpenAPI: the organisation queue lives under /v1/internal/memory/admin, which
// the real API opens to a signed-in admin session only. The fake lets a key send `Pramaan-Member`.

const DAY = 86_400_000;

interface Item {
  ref: string;
  user: string;
  text: string;
  createdAt: number;
  deleteApproval?: string;
}

interface Change {
  ref: string;
  user: string;
  event: "add" | "update" | "delete";
  text?: string;
  at: number;
}

interface OrgRow {
  id: string;
  text: string;
  kind: "org_candidate" | "org";
  status: "active" | "review" | "rejected";
  autoPromotedAt?: number;
  noticeReadAt?: number;
}

export interface MemoryState {
  items: Item[];
  changes: Change[];
  org: OrgRow[];
  eraseApprovals: Map<string, string>;
  seq: number;
}

const ref = (n: number) => `rh_mem${String(n).padStart(21, "0")}`;

function seedMemory(s: FakeState): MemoryState {
  const now = s.now();
  const m: MemoryState = { items: [], changes: [], org: [], eraseApprovals: new Map(), seq: 0 };
  const add = (user: string, text: string, ago: number) => {
    const item = { ref: ref(++m.seq), user, text, createdAt: now - ago * DAY };
    m.items.push(item);
    m.changes.push({ ref: item.ref, user, event: "add", text, at: item.createdAt });
  };
  add("user-42", "Prefers short emails with the answer in the first line.", 40);
  add("user-42", "Works as a product designer at a small company.", 33);
  add("user-42", "Likes a weekly summary on Monday mornings.", 21);
  add("user-42", "Is vegetarian and allergic to peanuts.", 9);
  add("user-42", "Is planning a trip to Lisbon in March.", 2);
  add("user-7", "Another person's private note that nobody else should ever see.", 5);
  m.org.push(
    { id: "mi_org_cand1", text: "The team writes customer emails in a friendly, plain tone.", kind: "org_candidate", status: "active" },
    { id: "mi_org_cand2", text: "Invoices are sent on the first working day of the month.", kind: "org_candidate", status: "review" },
    { id: "mi_org_auto1", text: "Support replies go out within one working day.", kind: "org", status: "active", autoPromotedAt: now - DAY },
  );
  return m;
}

export const memory = (s: FakeState): MemoryState => (s.memory ??= seedMemory(s));

/** Adds a memory for a person (what chats do over time). */
export function addFakeMemory(s: FakeState, user: string, text: string): string {
  const m = memory(s);
  const item = { ref: ref(++m.seq), user, text, createdAt: s.now() };
  m.items.push(item);
  m.changes.push({ ref: item.ref, user, event: "add", text, at: item.createdAt });
  return item.ref;
}

const iso = (ms: number) => new Date(ms).toISOString();

/** Applies approvals that have been decided: deletes and erases take effect. */
function sweep(c: FakeCtx): MemoryState {
  const m = memory(c.s);
  const drop = (item: Item, at: number) => {
    m.items.splice(m.items.indexOf(item), 1);
    m.changes.push({ ref: item.ref, user: item.user, event: "delete", text: item.text, at });
  };
  for (const item of [...m.items]) {
    const a = item.deleteApproval ? c.s.approvals.get(item.deleteApproval) : undefined;
    if (a?.status === "approved") drop(item, a.decidedAt ?? c.now);
    else if (a && a.status !== "pending") item.deleteApproval = undefined;
  }
  for (const [user, id] of [...m.eraseApprovals]) {
    const a = c.s.approvals.get(id);
    if (a?.status === "approved") {
      for (const item of m.items.filter((x) => x.user === user)) drop(item, a.decidedAt ?? c.now);
      m.eraseApprovals.delete(user);
    } else if (a && a.status !== "pending") m.eraseApprovals.delete(user);
  }
  return m;
}

const row = (i: Item) => ({ ref: i.ref, text: i.text, createdAt: iso(i.createdAt), updatedAt: iso(i.createdAt) });

function page<T>(c: FakeCtx, rows: T[], b: Record<string, unknown>) {
  const limit = Math.min(50, Math.max(1, Number(b.limit) || 10));
  const start = typeof b.cursor === "string" ? Number(b.cursor) || 0 : 0;
  const next = start + limit;
  return c.json(200, { results: rows.slice(start, next), ...(next < rows.length ? { nextCursor: String(next) } : {}) });
}

function capability(c: FakeCtx, id: string): Response | undefined {
  if (!id.startsWith("memory.")) return undefined;
  const m = sweep(c);
  const b = (c.body ?? {}) as Record<string, unknown>;
  const scope = b.scope as { namespace?: unknown; user?: unknown } | undefined;
  const needsScope = ["memory.items.list", "memory.items.search", "memory.history.list", "memory.scope.delete"].includes(id);
  if (needsScope && (!scope || typeof scope.namespace !== "string" || scope.namespace === ""))
    return c.fail(400, "invalid_request", "scope.namespace is required: the name of the memory set.");
  const user = typeof scope?.user === "string" ? scope.user : "";
  const mine = () => m.items.filter((i) => i.user === user && user !== "");
  const owned = () => m.items.find((i) => i.ref === b.ref && i.user === user && user !== "");
  const noItem = () => c.fail(404, "not_found", "No such memory. List them with memory.items.list.");
  // Reading or deleting one fact names it by ref only; ownership comes from the user in the scope.
  const needsUser = (id === "memory.item.get" || id === "memory.item.delete") && !(b.scope as { user?: unknown } | undefined)?.user;
  if (needsUser) return c.fail(400, "invalid_request", "scope.user is required: your end user's logical identifier.");

  switch (id) {
    case "memory.items.list": {
      const words = typeof b.keywords === "string" ? b.keywords.toLowerCase().split(/\s+/).filter(Boolean) : [];
      const rows = mine().filter((i) => words.every((w) => i.text.toLowerCase().includes(w))).sort((a, z) => z.createdAt - a.createdAt);
      return page(c, rows.map(row), b);
    }
    case "memory.items.search": {
      if (typeof b.query !== "string" || b.query.trim() === "") return c.fail(400, "invalid_request", "query is required: what to look for.");
      const words = b.query.toLowerCase().split(/\s+/).filter(Boolean);
      const rows = mine().filter((i) => words.some((w) => i.text.toLowerCase().includes(w)));
      return page(c, rows.map((i) => ({ ...row(i), similarity: 0.9 })), b);
    }
    case "memory.item.get": {
      const item = owned();
      return item ? c.json(200, { found: true, item: row(item) }) : noItem();
    }
    case "memory.item.delete": {
      const item = owned();
      if (!item) return noItem();
      if (b.confirm !== true) return c.fail(400, "invalid_request", "Send confirm: true to delete this memory for good.");
      item.deleteApproval ??= c.addApproval({ capability: id, priceMicro: 0, input: { ref: item.ref }, requestedBy: { kind: "key" }, createdAt: c.now });
      return c.json(202, { job_id: item.deleteApproval, status: "running", held_micro: 0 });
    }
    case "memory.scope.delete": {
      if (!user) return c.fail(400, "invalid_request", "scope.user is required to erase one person's memories.");
      if (b.confirm !== true) return c.fail(400, "invalid_request", "Send confirm: true to erase these memories for good.");
      if (mine().length === 0) return c.json(200, { deletedCount: 0 });
      const approval = m.eraseApprovals.get(user) ?? c.addApproval({ capability: id, priceMicro: 0, input: { scope: b.scope }, requestedBy: { kind: "key" }, createdAt: c.now });
      m.eraseApprovals.set(user, approval);
      return c.json(202, { job_id: approval, status: "running", held_micro: 0 });
    }
    case "memory.history.list": {
      const rows = m.changes.filter((x) => x.user === user && user !== "").sort((a, z) => z.at - a.at);
      return page(c, rows.map((x) => ({ ref: x.ref, event: x.event, ...(x.text ? { text: x.text } : {}), createdAt: iso(x.at) })), b);
    }
  }
  return c.fail(404, "not_found", "No capability with that id. List them with GET /v1/capabilities.");
}

const isAdmin = (c: FakeCtx) => {
  const member = c.s.members.find((x) => x.member_id === c.headers["pramaan-member"]);
  return member?.role === "owner" || member?.role === "admin";
};

function admin(c: FakeCtx): Response | undefined {
  const m = memory(c.s);
  if (c.method === "GET" && c.path === "/v1/internal/memory/admin/queue") {
    if (!isAdmin(c)) return c.fail(403, "forbidden", "Only workspace admins can manage org memory. Ask an admin to sign in.");
    return c.json(200, {
      enabled: true,
      rows: m.org.filter((o) => o.kind === "org_candidate" && (o.status === "active" || o.status === "review")).map((o) => ({ id: o.id, text: o.text, conflict: o.status === "review" })),
      notices: m.org.filter((o) => o.kind === "org" && o.status === "active" && o.autoPromotedAt && !o.noticeReadAt).map((o) => ({ id: o.id, text: o.text, promotedAt: iso(o.autoPromotedAt!) })),
    });
  }
  if (c.method === "POST" && c.path === "/v1/internal/memory/admin/decide") {
    if (!isAdmin(c)) return c.fail(403, "forbidden", "Only workspace admins can manage org memory. Ask an admin to sign in.");
    const b = (c.body ?? {}) as { id?: unknown; action?: unknown };
    if (typeof b.id !== "string" || !["approve", "reject", "remove", "acknowledge"].includes(String(b.action)))
      return c.fail(400, "invalid_request", "Send a memory id and approve, reject, remove or acknowledge, then retry.");
    const o = m.org.find((x) => x.id === b.id);
    if (!o) return c.fail(404, "not_found", "Org memory not found. Reload the queue and retry.");
    if (b.action === "reject" && o.kind !== "org_candidate") return c.fail(400, "invalid_request", "Only candidates can be rejected. Use remove for org memory.");
    if (b.action === "approve") Object.assign(o, { kind: "org", status: "active", noticeReadAt: c.now });
    else if (b.action === "acknowledge") o.noticeReadAt = c.now;
    else o.status = "rejected";
    return c.json(200, { ok: true });
  }
  return undefined;
}

/** The memory routes of this fake. Returns undefined for a route it doesn't serve. */
export function memoryRoutes(c: FakeCtx): Response | undefined {
  const m = c.path.match(/^\/v1\/capabilities\/([^/]+)$/);
  if (c.method === "POST" && m) return capability(c, decodeURIComponent(m[1]));
  return admin(c);
}
