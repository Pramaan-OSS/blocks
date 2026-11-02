import "server-only";
import postgres from "postgres";
import { canWrite, currentMemberId } from "@/lib/pramaan/session";

export class CrmProblem extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

// Replace with an authorised workspace lookup to share records across a team.
export async function crmScope(request: Request) {
  const member = await currentMemberId(request);
  if (!member) throw new CrmProblem("Sign in to see this.", 401);
  const scope = member;
  if (request.method !== "GET") {
    const origin = request.headers.get("origin");
    // Use the configured public origin when the app sits behind a rewriting proxy.
    const appOrigin = new URL(process.env.CRM_APP_URL || request.url).origin;
    if (origin && origin !== appOrigin) throw new CrmProblem("Please reload the page and try again.", 403);
    if (!await canWrite(member, scope)) throw new CrmProblem("You don't have permission to change this workspace.", 403);
  }
  return scope;
}

const memory = new Map<string, unknown>();
let sql: ReturnType<typeof postgres> | undefined;
export function crmDatabase() {
  if (!process.env.DATABASE_URL) throw new CrmProblem("Your workspace is not connected yet.", 503);
  return sql ??= postgres(process.env.DATABASE_URL, { max: 5, prepare: false });
}
export async function closeCrmDatabase() {
  await sql?.end();
  sql = undefined;
}
export function resetCrmFake() { memory.clear(); }
/** In-memory rows standing in for one table while the fake is on. */
export function fakeRows<T>(table: string): T[] {
  let rows = memory.get(`rows:${table}`) as T[] | undefined;
  if (!rows) memory.set(`rows:${table}`, rows = []);
  return rows;
}
type Block = "contacts" | "pipeline";
function table(block: Block) {
  if (block !== "contacts" && block !== "pipeline") throw new CrmProblem("Choose a workspace list.");
  return `crm_${block}`;
}
const jsonCopy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;
function documentJson(value: unknown) {
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json, "utf8") > MAX_DOCUMENT_BYTES) throw new CrmProblem("This workspace is full. Remove some entries before saving more.");
  return json;
}

export async function readData<T>(block: Block, scope: string, initial: T): Promise<T> {
  const name = table(block);
  if (process.env.PRAMAAN_FAKE === "1") return jsonCopy((memory.get(`${block}:${scope}`) ?? initial) as T);
  const rows = await crmDatabase().unsafe(`select data from ${name} where scope = $1`, [scope]);
  return rows[0]?.data ?? jsonCopy(initial);
}
export async function changeData<T>(block: Block, scope: string, initial: T, change: (state: T) => void): Promise<T> {
  const name = table(block);
  if (process.env.PRAMAAN_FAKE === "1") {
    const key = `${block}:${scope}`;
    const state = jsonCopy((memory.get(key) ?? initial) as T);
    change(state);
    const stored = JSON.parse(documentJson(state)) as T;
    memory.set(key, stored);
    return jsonCopy(stored);
  }
  return await crmDatabase().begin(async tx => {
    // Bind serialized JSON as text so the driver does not encode the string a second time.
    await tx.unsafe(`insert into ${name} (scope, data) values ($1, $2::text::jsonb) on conflict (scope) do nothing`, [scope, documentJson(initial)]);
    const rows = await tx.unsafe(`select data from ${name} where scope = $1 for update`, [scope]);
    const state = rows[0].data as T;
    change(state);
    const json = documentJson(state);
    await tx.unsafe(`update ${name} set data = $2::text::jsonb where scope = $1`, [scope, json]);
    return JSON.parse(json) as T;
  }) as T;
}

export function checkRevision(record: { revision: number }, expected: unknown, noun: "contact" | "card") {
  if (!Number.isSafeInteger(expected) || expected !== record.revision) throw new CrmProblem(`This ${noun} changed since you opened it. Reload to see the latest.`, 409);
}
export function text(value: unknown, label: string, max = 200, required = true): string {
  if (typeof value !== "string" || (required && !value.trim())) throw new CrmProblem(`Enter ${label}.`);
  if (value.trim().length > max) throw new CrmProblem(`Use ${label} of up to ${max} characters.`);
  return value.trim();
}

const MAX_BODY_BYTES = 20_000;
const shorterEntry = () => new CrmProblem("Please use a shorter entry.");
export async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new CrmProblem("Please check the form and try again.", 415);
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    if (!/^\d+$/.test(declared)) throw new CrmProblem("Please check the form and try again.");
    if (Number(declared) > MAX_BODY_BYTES) throw shorterEntry();
  }
  const reader = request.body?.getReader();
  if (!reader) throw new CrmProblem("Please check the form and try again.");
  let size = 0;
  let raw = "";
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw shorterEntry();
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  } finally { reader.releaseLock(); }
  let body: unknown;
  try { body = JSON.parse(raw); } catch { throw new CrmProblem("Please check the form and try again."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new CrmProblem("Please check the form and try again.");
  return body as Record<string, unknown>;
}
export async function crmRoute(request: Request, run: (scope: string, body: Record<string, unknown>) => Promise<unknown>) {
  try {
    const scope = await crmScope(request);
    const body = request.method === "GET" ? {} : await readBody(request);
    return Response.json(await run(scope, body), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: { message: error instanceof CrmProblem ? error.message : "Something went wrong. Please try again." } }, { status: error instanceof CrmProblem ? error.status : 500, headers: { "Cache-Control": "no-store" } });
  }
}
