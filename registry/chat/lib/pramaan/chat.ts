import "server-only";
import { PramaanError } from "@pramaan/sdk";
import { CHAT_MODEL, CHAT_SYSTEM, CHAT_TOOLS } from "@/lib/pramaan/chat-tools";
import { actionName } from "@/lib/pramaan/plain";
import { asViewer, capability, currentViewer, pramaan, signedOut, transport, type TopUp, type Viewer } from "@/lib/pramaan/server";

// Server half of the chat block. One reply is one `llm.chat` call, streamed to the browser; the
// model keeps no memory, so the browser sends the conversation each time. Tools the model asks for
// run through `runTool`: an action that needs a yes is held by Pramaan and waits in the approvals
// inbox, and `toolJob` reports how it ended.

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: Record<string, unknown>;
}

export type ChatMessage =
  | { readonly role: "user"; readonly content: string }
  | { readonly role: "assistant"; readonly content?: string; readonly toolCalls?: readonly ToolCall[] }
  | { readonly role: "tool"; readonly toolCallId: string; readonly content: string };

/** How a tool run stands. `waiting` means a member's yes is needed first (or the job is still running). */
export type ToolOutcome =
  | { readonly state: "done"; readonly name: string; readonly result: unknown }
  | { readonly state: "waiting"; readonly name: string; readonly job: string }
  | { readonly state: "failed"; readonly message: string };

const MAX_MESSAGES = 60;
const MAX_CHARS = 20_000;

const bad = (message: string) => new PramaanError("invalid_request", message, { status: 400 });
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

async function signedIn(request: Request): Promise<Viewer> {
  const viewer = await currentViewer(request);
  if (!viewer.memberId) throw signedOut("Chat is for signed-in people.");
  return viewer;
}

/** The conversation from the browser, checked. A system message is never accepted: yours is added here. */
export function cleanMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw) || raw.length < 1) throw bad("Send a message to start.");
  if (raw.length > MAX_MESSAGES) throw bad("This conversation is too long. Start a new one.");
  const out: ChatMessage[] = [];
  const asked = new Set<string>();
  for (const m of raw) {
    if (!isObject(m)) throw bad("A message wasn't understood.");
    const content = m.content;
    if (content !== undefined && (typeof content !== "string" || content.length > MAX_CHARS)) throw bad(`Keep each message under ${MAX_CHARS.toLocaleString("en")} characters.`);
    if (m.role === "user") {
      if (!content?.trim()) throw bad("Type a message first.");
      out.push({ role: "user", content });
    } else if (m.role === "assistant") {
      const calls = Array.isArray(m.toolCalls) ? m.toolCalls : [];
      const toolCalls = calls.map((t): ToolCall => {
        if (!isObject(t) || typeof t.id !== "string" || typeof t.name !== "string" || !isObject(t.arguments)) throw bad("A message wasn't understood.");
        asked.add(t.id);
        return { id: t.id, name: t.name, arguments: t.arguments };
      });
      out.push({ role: "assistant", ...(content ? { content } : {}), ...(toolCalls.length ? { toolCalls } : {}) });
    } else if (m.role === "tool") {
      if (typeof m.toolCallId !== "string" || !asked.has(m.toolCallId) || content === undefined) throw bad("A message wasn't understood.");
      out.push({ role: "tool", toolCallId: m.toolCallId, content });
    } else throw bad("A message wasn't understood.");
  }
  if (out[out.length - 1].role === "assistant" && !(out[out.length - 1] as { toolCalls?: unknown }).toolCalls) throw bad("Type a message first.");
  return out;
}

// Only these events go to the browser. Anything else the stream carries stays on the server.
const EVENTS = new Set(["text_delta", "tool_call_start", "tool_call_delta", "tool_call_end", "usage", "done", "error"]);

function onlyKnownEvents(upstream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  let buf = "";
  return upstream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctl) {
        buf += dec.decode(chunk, { stream: true }).replace(/\r\n/g, "\n");
        const frames = buf.split("\n\n");
        buf = frames.pop() ?? "";
        for (const f of frames) if (f.startsWith(":") || EVENTS.has(/^event: *(\S+)/.exec(f)?.[1] ?? "")) ctl.enqueue(enc.encode(`${f}\n\n`));
      },
    }),
  );
}

/** One streamed reply. The person must be signed in: every reply costs credit. */
export async function chatStream(request: Request, body: { messages?: unknown }): Promise<Response> {
  const viewer = await signedIn(request);
  const t = transport();
  const res = await t.fetch(`${t.baseUrl}/v1/capabilities/llm.chat`, {
    method: "POST",
    headers: { Authorization: `Bearer ${t.apiKey}`, "Content-Type": "application/json", Accept: "text/event-stream", ...asViewer(viewer) },
    body: JSON.stringify({
      messages: [{ role: "system", content: CHAT_SYSTEM }, ...cleanMessages(body.messages)],
      tools: Object.entries(CHAT_TOOLS).map(([name, t]) => ({ name, description: t.description, parameters: t.parameters })),
      model: CHAT_MODEL,
    }),
    // Stopping in the browser stops the reply, and the spend.
    signal: request.signal,
    cache: "no-store",
  });
  if (!res.ok || !res.body) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = ((await res.json().catch(() => undefined)) as { error?: Record<string, any> } | undefined)?.error ?? {};
    throw Object.assign(
      new PramaanError(e.code ?? "internal", e.message ?? `Pramaan answered ${res.status}.`, { status: res.status, next: e.next }),
      e.top_up ? { topUp: e.top_up as TopUp } : {},
    );
  }
  return new Response(onlyKnownEvents(res.body), { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" } });
}

/** Runs one tool the model asked for. `key` is this click's idempotency key: a retry never runs it twice. */
export async function runTool(request: Request, body: { name?: unknown; arguments?: unknown }, key: string | null): Promise<ToolOutcome> {
  const viewer = await signedIn(request);
  const tool = typeof body.name === "string" && Object.hasOwn(CHAT_TOOLS, body.name) ? CHAT_TOOLS[body.name] : undefined;
  if (!tool) throw bad("That action isn't available in this chat.");
  if (!isObject(body.arguments) || JSON.stringify(body.arguments).length > 10_000) throw bad("The details for that action were not understood.");
  const name = actionName(tool.capability);
  const res = await capability<Record<string, unknown>>(tool.capability, body.arguments, { ...asViewer(viewer), "Idempotency-Key": key || crypto.randomUUID() });
  // 202: held for a member's yes. The job is polled with toolJob.
  return res.status === "running" && typeof res.job_id === "string" ? { state: "waiting", name, job: res.job_id } : { state: "done", name, result: res };
}

const JOB = /^(apr|job)_[A-Za-z0-9_-]{3,120}$/;

/** How a held tool run ended: still waiting, done, or failed (declined, expired). */
export async function toolJob(request: Request, id: string | null): Promise<ToolOutcome> {
  const viewer = await signedIn(request);
  if (!id || !JOB.test(id)) throw bad("That request couldn't be found.");
  const j = await pramaan<{ status: string; capability?: string; result?: unknown; error?: { message?: string } }>(`/v1/jobs/${encodeURIComponent(id)}`, { headers: asViewer(viewer) });
  const name = j.capability ? actionName(j.capability) : "That action";
  if (j.status === "running") return { state: "waiting", name, job: id };
  if (j.status === "done") return { state: "done", name, result: j.result ?? {} };
  return { state: "failed", message: j.error?.message ?? (j.status === "cancelled" ? "It was cancelled, so nothing ran." : "It didn't run.") };
}
