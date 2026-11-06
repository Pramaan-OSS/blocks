import "server-only";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { request } from "node:http";
import path from "node:path";
import { after } from "next/server";
import { crmDatabase, fakeRows, text, CrmProblem } from "@/lib/pramaan/crm-data";
import { blockedEitherWay, isHidden, moderate, notBlockedSql, reportTarget } from "@/lib/pramaan/moderation";
import { memberEmail } from "@/lib/pramaan/social-context";

/** `name` is only ever the person's public display name. `ref` is never shown. */
export type Conversation = { id: string; person: { ref: string; name?: string }; preview?: string; at?: string; unread: number };
export type Message = { id: string; mine: boolean; text: string; at: string; read: boolean };
export type Thread = { id: string; person: Conversation["person"]; messages: Message[]; earlier?: string };
type ConversationRow = { id: string; scope: string; a: string; b: string; startedBy: string; readA: number; readB: number; lastAt?: string; createdAt: string };
type MessageRow = { id: string; seq: number; scope: string; conversationId: string; sender: string; body: string; at: string };

const SHOWN = 50;
const CONVERSATIONS_SHOWN = 100;
const isFake = () => process.env.PRAMAAN_FAKE === "1";
const iso = (value: Date | string | null | undefined) => value ? new Date(value).toISOString() : undefined;
const messageRef = (id: string) => `message:${id}`;
const gone = () => new CrmProblem("This conversation isn't available.", 404);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idOf = (value: unknown) => {
  if (typeof value !== "string" || !UUID.test(value)) throw gone();
  return value.toLowerCase();
};
const fakeConversations = () => fakeRows<ConversationRow>("crm_conversation");
const fakeMessages = () => fakeRows<MessageRow>("crm_message");
function fakeSeq() { const seq = fakeRows<number>("crm_message_seq"); seq.push(0); return seq.length; }
function fakeName(scope: string, person: string) {
  const profile = fakeRows<{ scope: string; person: string; name: string; public: { name: boolean } }>("crm_profile").find(p => p.scope === scope && p.person === person);
  return profile?.public.name && profile.name ? profile.name : undefined;
}
const person = (ref: string, name: string | null | undefined) => ({ ref, ...(name ? { name } : {}) });

export async function conversationList(scope: string, member: string): Promise<{ conversations: Conversation[] }> {
  if (isFake()) {
    const rows = fakeConversations().filter(c => c.scope === scope && (c.a === member || c.b === member) && (c.lastAt || c.startedBy === member));
    const out: Conversation[] = [];
    for (const c of rows) {
      const other = c.a === member ? c.b : c.a;
      if (await blockedEitherWay(member, other, scope)) continue;
      const seen = c.a === member ? c.readA : c.readB;
      const shown: MessageRow[] = [];
      for (const m of fakeMessages().filter(m => m.conversationId === c.id)) if (!await isHidden(messageRef(m.id), scope)) shown.push(m);
      const last = shown.at(-1);
      out.push({ id: c.id, person: person(other, fakeName(scope, other)), ...(last ? { preview: last.body.slice(0, 120), at: last.at } : {}), unread: shown.filter(m => m.seq > seen && m.sender !== member).length });
    }
    return { conversations: out.sort((x, y) => (y.at ?? "").localeCompare(x.at ?? "")).slice(0, CONVERSATIONS_SHOWN) };
  }
  const sql = crmDatabase();
  const shown = sql`not exists (select 1 from crm_hidden_item h where h.scope = ${scope} and h.ref = ${"message:"} || x.id::text)`;
  // ponytail: the 100 most recent conversations; add cursor paging for people with more than that.
  const rows = await sql`select c.id, me.other, me.seen, case when n.public_name then nullif(n.name, '') end as other_name, last.body as preview, last.created_at as last_message_at,
      (select count(*)::int from crm_message x where x.conversation_id = c.id and x.seq > me.seen and x.sender <> ${member} and ${shown}) as unread
    from crm_conversation c
    cross join lateral (select case when c.person_a = ${member} then c.person_b else c.person_a end as other, case when c.person_a = ${member} then c.read_a else c.read_b end as seen) me
    left join crm_profile n on n.scope = c.scope and n.person = me.other
    left join lateral (select x.body, x.created_at from crm_message x where x.conversation_id = c.id and ${shown} order by x.seq desc limit 1) last on true
    where c.scope = ${scope} and (c.person_a = ${member} or c.person_b = ${member}) and (c.last_at is not null or c.started_by = ${member})
      and ${notBlockedSql(scope, member, sql`me.other`)}
    order by coalesce(c.last_at, c.created_at) desc limit ${CONVERSATIONS_SHOWN}`;
  return { conversations: rows.map(r => ({ id: r.id, person: person(r.other, r.other_name), ...(r.preview ? { preview: String(r.preview).slice(0, 120), at: iso(r.last_message_at) } : {}), unread: r.unread })) };
}
type Open = { other: string; mineIsA: boolean; seen: number; theirs: number };
/** Only a participant gets past this, and never across a block. The answer is the same for a stranger as for a missing id. */
async function openConversation(scope: string, member: string, id: string): Promise<Open> {
  let row: { a: string; b: string; readA: number | string; readB: number | string } | undefined;
  if (isFake()) row = fakeConversations().find(c => c.scope === scope && c.id === id);
  else row = (await crmDatabase()`select person_a as a, person_b as b, read_a as "readA", read_b as "readB" from crm_conversation where scope = ${scope} and id = ${id}`)[0] as never;
  if (!row || (row.a !== member && row.b !== member)) throw gone();
  const mineIsA = row.a === member;
  const other = mineIsA ? row.b : row.a;
  if (await blockedEitherWay(member, other, scope)) throw gone();
  return { other, mineIsA, seen: Number(mineIsA ? row.readA : row.readB), theirs: Number(mineIsA ? row.readB : row.readA) };
}
function validCursor(cursor: string | null | undefined) {
  if (!cursor) return undefined;
  if (!/^\d{1,18}$/.test(cursor)) throw new CrmProblem("Reload to see the latest messages.");
  return cursor;
}
export async function thread(scope: string, member: string, conversation: string, before?: string | null): Promise<Thread> {
  const id = idOf(conversation);
  const open = await openConversation(scope, member, id);
  const cursor = validCursor(before);
  const shape = (m: { id: string; seq: number; sender: string; body: string; at: string }): Message => ({ id: m.id, mine: m.sender === member, text: m.body, at: m.at, read: m.sender === member && m.seq <= open.theirs });
  let rows: { id: string; seq: number; sender: string; body: string; at: string }[] = [];
  let name: string | undefined;
  if (isFake()) {
    name = fakeName(scope, open.other);
    const newest = fakeMessages().filter(m => m.conversationId === id && (!cursor || m.seq < Number(cursor))).sort((x, y) => y.seq - x.seq);
    for (const m of newest) {
      if (rows.length > SHOWN) break;
      if (!await isHidden(messageRef(m.id), scope)) rows.push(m);
    }
  } else {
    const sql = crmDatabase();
    const [profile] = await sql`select case when public_name then nullif(name, '') end as name from crm_profile where scope = ${scope} and person = ${open.other}`;
    name = profile?.name ?? undefined;
    const found = await sql`select x.id, x.seq, x.sender, x.body, x.created_at from crm_message x
      where x.conversation_id = ${id} and ${cursor ? sql`x.seq < ${cursor}::bigint` : sql`true`}
        and not exists (select 1 from crm_hidden_item h where h.scope = ${scope} and h.ref = ${"message:"} || x.id::text)
      order by x.seq desc limit ${SHOWN + 1}`;
    rows = found.map(m => ({ id: m.id, seq: Number(m.seq), sender: m.sender, body: m.body, at: iso(m.created_at)! }));
  }
  const page = rows.slice(0, SHOWN);
  return { id, person: person(open.other, name), messages: page.map(shape).reverse(), ...(rows.length > SHOWN ? { earlier: String(page[SHOWN - 1].seq) } : {}) };
}
async function start(scope: string, member: string, body: Record<string, unknown>) {
  const other = text(body.person, "a person", 200);
  if (other === member) throw new CrmProblem("Choose another person.");
  if (await blockedEitherWay(member, other, scope)) throw new CrmProblem("This person can't be messaged.", 404);
  const [a, b] = member < other ? [member, other] : [other, member];
  if (isFake()) {
    let row = fakeConversations().find(c => c.scope === scope && c.a === a && c.b === b);
    if (!row) fakeConversations().push(row = { id: randomUUID(), scope, a, b, startedBy: member, readA: 0, readB: 0, createdAt: new Date().toISOString() });
    return { id: row.id };
  }
  const sql = crmDatabase();
  // Two people starting at once land on the same row.
  await sql`insert into crm_conversation (id, scope, person_a, person_b, started_by) values (${randomUUID()}, ${scope}, ${a}, ${b}, ${member}) on conflict (scope, person_a, person_b) do nothing`;
  const [row] = await sql`select id from crm_conversation where scope = ${scope} and person_a = ${a} and person_b = ${b}`;
  return { id: row.id as string };
}
async function send(scope: string, member: string, body: Record<string, unknown>) {
  const conversationId = idOf(body.id);
  const content = text(body.text, "a message", 4000);
  const open = await openConversation(scope, member, conversationId);
  const id = randomUUID();
  let firstUnread: boolean;
  if (isFake()) {
    firstUnread = !fakeMessages().some(m => m.conversationId === conversationId && m.sender === member && m.seq > open.theirs);
    const at = new Date().toISOString();
    fakeMessages().push({ id, seq: fakeSeq(), scope, conversationId, sender: member, body: content, at });
    fakeConversations().find(c => c.id === conversationId)!.lastAt = at;
  } else {
    firstUnread = await crmDatabase().begin(async tx => {
      const [earlier] = await tx`select 1 from crm_message where conversation_id = ${conversationId} and sender = ${member} and seq > ${open.theirs} limit 1`;
      await tx`insert into crm_message (id, scope, conversation_id, sender, body) values (${id}, ${scope}, ${conversationId}, ${member}, ${content})`;
      await tx`update crm_conversation set last_at = now() where id = ${conversationId}`;
      return !earlier;
    });
  }
  // One notice for a run of unread messages, not one for each.
  if (firstUnread) after(() => noticeNewMessage(scope, open.other, `message:${conversationId}:${open.theirs}`));
  return { id };
}
async function markRead(scope: string, member: string, body: Record<string, unknown>) {
  const id = idOf(body.id);
  const open = await openConversation(scope, member, id);
  if (isFake()) {
    const newest = Math.max(0, ...fakeMessages().filter(m => m.conversationId === id).map(m => m.seq));
    Object.assign(fakeConversations().find(c => c.id === id)!, open.mineIsA ? { readA: newest } : { readB: newest });
  } else if (open.mineIsA) await crmDatabase()`update crm_conversation set read_a = greatest(read_a, coalesce((select max(seq) from crm_message where conversation_id = ${id}), 0)) where id = ${id}`;
  else await crmDatabase()`update crm_conversation set read_b = greatest(read_b, coalesce((select max(seq) from crm_message where conversation_id = ${id}), 0)) where id = ${id}`;
  return { read: true };
}
async function report(scope: string, member: string, body: Record<string, unknown>) {
  const conversationId = idOf(body.id);
  const why = text(body.reason, "a reason", 1000);
  const messageId = idOf(body.message);
  await openConversation(scope, member, conversationId);
  let row: { sender: string; body: string } | undefined;
  if (isFake()) row = fakeMessages().find(m => m.conversationId === conversationId && m.id === messageId);
  else row = (await crmDatabase()`select sender, body from crm_message where conversation_id = ${conversationId} and id = ${messageId}`)[0] as never;
  // Only the other person's messages, and only one a participant can read: reviewers see nothing else from a conversation.
  if (!row || row.sender === member || await isHidden(messageRef(messageId), scope)) throw new CrmProblem("This message is no longer available.", 404);
  await reportTarget(scope, member, { kind: "item", ref: messageRef(messageId) }, why, false, { label: "Private message", href: `/profiles/${encodeURIComponent(row.sender)}`, excerpt: row.body.slice(0, 280) });
  return { message: "Report sent." };
}

const NOTICE = { subject: "You have a new message", text: "Someone sent you a message. Open the app to read it." };
/** Fixed words only: what a person typed never leaves the app in an email. */
export async function noticeNewMessage(scope: string, recipient: string, key: string) {
  if (process.env.PRAMAAN_MESSAGE_EMAIL !== "1") return;
  const to = await memberEmail(recipient, scope).catch(() => undefined);
  if (!to) return;
  if (isFake()) { fakeRows<{ to: string; key: string }>("crm_message_notice").push({ to, key }); return; }
  await sendThroughEmailModule({ to, ...NOTICE }, key).catch(() => undefined);
}
/**
 * The platform's email module, as the email-notices block calls it: the same key never sends twice.
 * Not the `email.send` capability, whose inputs wait in the approvals inbox.
 */
export async function sendThroughEmailModule(mail: { to: string; subject: string; text: string }, key: string, directory = process.env.PRAMAAN_MODULES_DIR ?? "/pramaan-modules") {
  const token = (await readFile(path.join(directory, "token"), "utf8")).trim();
  const body = JSON.stringify(mail);
  await new Promise<void>((resolve, reject) => {
    const sent = request({
      socketPath: path.join(directory, "modules.sock"), path: "/v1/email", method: "POST", timeout: 10_000,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "content-length": Buffer.byteLength(body), "idempotency-key": key },
    }, response => { response.resume(); response.on("end", resolve); response.on("error", reject); });
    sent.on("timeout", () => sent.destroy());
    sent.on("error", reject);
    sent.end(body);
  });
}

export async function messagingAction(scope: string, member: string, body: Record<string, unknown>) {
  switch (body.action) {
    case "start": return start(scope, member, body);
    case "send": return send(scope, member, body);
    case "read": return markRead(scope, member, body);
    case "report": return report(scope, member, body);
    case "block": return moderate(scope, member, { action: "block", ref: body.person });
    default: throw new CrmProblem("Choose an action to continue.");
  }
}
