import type { FakeCtx } from "./fake";
import { platform } from "./fake-platform";

// A small fake catalogue of single actions ("superpowers"): search with a clarify question and near
// misses, a described capability with its request schema, an estimate, and a run. Actions that send
// something wait for a member's approval in the approvals inbox, as a call made with a key does.
// Extends the core fake; email.send runs in fake-assessment.ts, which answers first.

type Schema = { type: "object"; required?: string[]; properties: Record<string, Record<string, unknown>> };

interface Cap {
  id: string;
  description: string;
  effect_class: string;
  price_estimate_micro: number;
  requires_approval?: true;
  schema: Schema;
  run?(input: Record<string, unknown>): unknown;
}

const CAPS: Cap[] = [
  {
    id: "web.search",
    description: "Searches the web and returns the top results with a short snippet.",
    effect_class: "read_only",
    price_estimate_micro: 5_000,
    schema: { type: "object", required: ["query"], properties: { query: { type: "string", maxLength: 500, description: "What to search for." } } },
    run: (i) => ({ results: [{ title: `Results for ${String(i.query)}`, url: "https://example.com/a", snippet: "A short summary of the first result." }, { title: "Another source", url: "https://example.com/b", snippet: "A second, shorter summary." }] }),
  },
  {
    id: "web.read",
    description: "Reads one web page and returns its text.",
    effect_class: "read_only",
    price_estimate_micro: 4_000,
    schema: { type: "object", required: ["url"], properties: { url: { type: "string", maxLength: 2048, description: "The page to read, starting with https://." } } },
    run: (i) => ({ title: "Example page", text: `The text of ${String(i.url)}.` }),
  },
  {
    id: "llm.complete",
    description: "Writes text from an instruction.",
    effect_class: "read_only",
    price_estimate_micro: 12_000,
    schema: {
      type: "object",
      required: ["prompt"],
      properties: {
        prompt: { type: "string", maxLength: 4000, description: "What to write." },
        maxWords: { type: "integer", minimum: 1, maximum: 500, description: "Longest answer, in words." },
      },
    },
    run: (i) => ({ text: `Here is a draft for: ${String(i.prompt)}` }),
  },
  {
    id: "email.send",
    description: "Sends one email from your connected inbox.",
    effect_class: "external_irreversible",
    price_estimate_micro: 2_000,
    requires_approval: true,
    schema: {
      type: "object",
      required: ["to", "subject", "text"],
      properties: {
        to: { type: "string", maxLength: 320, description: "Who to send it to." },
        subject: { type: "string", maxLength: 300 },
        text: { type: "string", maxLength: 10000, description: "The message." },
      },
    },
  },
  {
    id: "sms.send",
    description: "Sends a text message to one phone number.",
    effect_class: "external_irreversible",
    price_estimate_micro: 9_100,
    requires_approval: true,
    schema: {
      type: "object",
      required: ["to", "text"],
      properties: {
        to: { type: "string", maxLength: 32, description: "The phone number, with country code." },
        text: { type: "string", maxLength: 1600, description: "The message." },
      },
    },
  },
];

const info = (c: Cap) => ({
  id: c.id,
  description: c.description,
  effect_class: c.effect_class,
  mode: "sync",
  price_estimate_micro: c.price_estimate_micro,
  available: true,
  needs_connection: false,
  ...(c.requires_approval ? { requires_approval: true } : {}),
});

/** The fuller answer for GET /v1/capabilities/{id}. */
export function catalogueDescribe(id: string) {
  const c = CAPS.find((x) => x.id === id);
  return c ? { ...info(c), request_schema: c.schema, result_schema: { type: "object" } } : undefined;
}

const words = (q: string) => q.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

function search(c: FakeCtx, query: string): Response {
  const q = words(query);
  if (q.length === 0) return c.json(200, { results: CAPS.map(info) });
  const scored = CAPS.map((cap) => {
    const text = `${cap.id.replace(/[._-]/g, " ")} ${cap.description}`.toLowerCase();
    return { cap, score: q.filter((w) => text.includes(w)).length };
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return c.json(200, { results: [], near_misses: [{ missed: q }] });
  // Two sends that tie: ask which one is meant.
  const tied = scored.filter((x) => x.score === scored[0].score && /\.send$/.test(x.cap.id));
  const clarify =
    q.includes("send") && !q.some((w) => ["email", "mail", "text", "sms"].includes(w)) && tied.length > 1
      ? { question: "Do you want to send an email or a text message?", options: [{ id: "email.send", label: "Send an email" }, { id: "sms.send", label: "Send a text message" }] }
      : undefined;
  return c.json(200, { results: scored.map((x) => info(x.cap)), ...(clarify ? { clarify } : {}) });
}

function problem(cap: Cap, input: Record<string, unknown>): string | undefined {
  for (const key of cap.schema.required ?? []) {
    const v = input[key];
    if (typeof v !== "string" || v.trim() === "") return `${key} is required: ${String(cap.schema.properties[key]?.description ?? "send a value").replace(/\.$/, "").toLowerCase()}.`;
  }
  return undefined;
}

/** The catalogue routes of this fake. Returns undefined for a route it doesn't serve. */
export function catalogueRoutes(c: FakeCtx): Response | undefined {
  if (c.method === "GET" && c.path === "/v1/capabilities") return search(c, c.url.searchParams.get("query") ?? "");
  const m = c.path.match(/^\/v1\/capabilities\/([^/]+?)(\/estimate)?$/);
  if (c.method !== "POST" || !m) return undefined;
  const cap = CAPS.find((x) => x.id === decodeURIComponent(m[1]));
  if (!cap) return undefined;
  const input = (c.body ?? {}) as Record<string, unknown>;
  const bad = problem(cap, input);
  if (m[2]) {
    const available = platform(c.s).balanceMicro - [...c.s.holds.values()].reduce((n, x) => n + x, 0);
    return c.json(200, { price_max_micro: cap.price_estimate_micro, ready: !bad, can_run: !bad && available >= cap.price_estimate_micro, ...(bad ? { message: bad } : {}) });
  }
  if (bad) return c.fail(400, "invalid_request", bad);
  if (cap.requires_approval) {
    const p = platform(c.s);
    const key = c.headers["idempotency-key"];
    const prior = key ? p.idem.get(`cat:${cap.id}:${key}`) : undefined;
    const approval = prior ?? c.addApproval({ capability: cap.id, priceMicro: cap.price_estimate_micro, input, requestedBy: { kind: "key" }, createdAt: c.now });
    if (key) p.idem.set(`cat:${cap.id}:${key}`, approval);
    return c.json(202, { job_id: approval, status: "running", held_micro: 0 });
  }
  return c.json(200, cap.run!(input));
}
