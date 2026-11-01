import { ApiError } from "@/lib/pramaan/client";

// Reads the reply stream (server-sent events) from this app's chat route.

export interface Call {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface Turn {
  text: string;
  toolCalls: Call[];
  /** What the reply cost, micro-USD, when the stream says. */
  priceMicro?: number;
}

interface Frame {
  event: string;
  data: unknown;
}

async function* frames(body: ReadableStream<Uint8Array>): AsyncGenerator<Frame> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const parse = (raw: string): Frame | undefined => {
    let event = "message";
    const data: string[] = [];
    for (const line of raw.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    if (data.length === 0) return undefined;
    try {
      return { event, data: JSON.parse(data.join("\n")) };
    } catch {
      return undefined;
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    buf += dec.decode(value, { stream: !done }).replace(/\r\n/g, "\n");
    const parts = buf.split("\n\n");
    buf = done ? "" : (parts.pop() ?? "");
    for (const p of parts) {
      const f = parse(p);
      if (f) yield f;
    }
    if (done) return;
  }
}

/**
 * Reads one whole reply, calling `onText` with the text so far as it arrives. Returns the finished
 * turn. A stream that ends without finishing, or an error event, throws a plain ApiError.
 */
export async function readTurn(body: ReadableStream<Uint8Array>, onText: (textSoFar: string) => void): Promise<Turn> {
  let text = "";
  const calls: { id: string; name: string; args: string }[] = [];
  for await (const { event, data } of frames(body)) {
    const d = data as Record<string, unknown>;
    if (event === "text_delta" && typeof d.text === "string") onText((text += d.text));
    else if (event === "tool_call_start") calls[Number(d.index)] = { id: String(d.id), name: String(d.name), args: "" };
    else if (event === "tool_call_delta" && calls[Number(d.index)]) calls[Number(d.index)].args += String(d.arguments ?? "");
    else if (event === "error") throw new ApiError(String(d.message ?? "The reply stopped. Try again."), String(d.code ?? "internal"));
    else if (event === "done") {
      const result = (d.result ?? {}) as { text?: string; toolCalls?: Call[] };
      // The finished result is the whole answer; the deltas only showed it growing.
      const toolCalls = result.toolCalls ?? calls.filter(Boolean).map((c) => ({ id: c.id, name: c.name, arguments: parseArgs(c.args) }));
      return { text: result.text ?? text, toolCalls, ...(typeof d.price_micro === "number" ? { priceMicro: d.price_micro } : {}) };
    }
  }
  throw new ApiError("The reply stopped before it finished. Try again.", "stream_ended");
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || "{}");
    return typeof v === "object" && v !== null && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}
