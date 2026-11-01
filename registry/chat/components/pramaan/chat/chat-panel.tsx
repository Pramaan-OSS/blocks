"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { InputFields } from "@/components/pramaan/fields";
import { StatusPill, type PillTone } from "@/components/pramaan/parts";
import { EmptyState, ErrorState, StatusMessage } from "@/components/pramaan/states";
import { ApiError, api, formatMicro } from "@/lib/pramaan/client";
import { humanize, plainProblem } from "@/lib/pramaan/plain";
import { SendHorizontal } from "lucide-react";
import type { ToolOutcome } from "@/lib/pramaan/chat";
import { readTurn, type Call } from "@/components/pramaan/chat/stream";

// A chat with an assistant. The conversation lives in this browser; each reply is streamed from
// this app's own route. When the assistant wants to do something, the action runs on the server and
// anything that needs a yes waits in the approvals inbox (the approvals block), then the chat goes on.

type Message =
  | { role: "user"; content: string }
  | { role: "assistant"; content?: string; toolCalls?: Call[] }
  | { role: "tool"; toolCallId: string; content: string };

type ToolState = "running" | "waiting" | "done" | "failed";

type Item =
  | { key: number; kind: "user" | "assistant"; text: string; cost?: number }
  | { key: number; kind: "tool"; name: string; input: Record<string, unknown>; state: ToolState; message?: string };

const TOOL_WORDS: Record<ToolState, { label: string; tone: PillTone }> = {
  running: { label: "Working", tone: "blue" },
  waiting: { label: "Waiting for a yes", tone: "amber" },
  done: { label: "Done", tone: "green" },
  failed: { label: "Didn't run", tone: "red" },
};

const MAX_ROUNDS = 5;
const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), reject(new DOMException("Stopped", "AbortError"))), { once: true });
  });

/**
 * The chat. `approvalsHref` is where your approvals inbox lives. `pollMs` is how often a waiting
 * action is checked.
 */
export function Chat({ approvalsHref = "/", pollMs = 2_000 }: { approvalsHref?: string; pollMs?: number }) {
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError>();
  const [note, setNote] = useState<string>();
  const [draft, setDraft] = useState("");
  const history = useRef<Message[]>([]);
  const seq = useRef(0);
  const abort = useRef<AbortController>(undefined);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [items]);
  useEffect(() => () => abort.current?.abort(), []);

  const add = (item: Item extends infer T ? (T extends unknown ? Omit<T, "key"> : never) : never) => {
    const key = ++seq.current;
    setItems((all) => [...all, { ...item, key } as Item]);
    return key;
  };
  const patch = (key: number, change: Partial<Item>) => setItems((all) => all.map((i) => (i.key === key ? ({ ...i, ...change } as Item) : i)));

  async function reply(signal: AbortSignal): Promise<Call[]> {
    const res = await fetch("/api/pramaan/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: history.current }), signal, cache: "no-store" }).catch((e) => {
      if ((e as Error).name === "AbortError") throw e;
      throw new ApiError("Can't reach the server. Check your connection and try again.", "network");
    });
    if (!res.ok || !res.body) {
      const e = (await res.json().catch(() => undefined))?.error ?? {};
      const p = plainProblem(e.code ?? "internal", res.status, e.message ?? "", e.next);
      throw new ApiError(p.message, e.code ?? "internal", p.next, res.status, e.top_up);
    }
    const key = add({ kind: "assistant", text: "" });
    const turn = await readTurn(res.body, (text) => patch(key, { text }));
    patch(key, { text: turn.text, ...(turn.priceMicro !== undefined ? { cost: turn.priceMicro } : {}) });
    if (!turn.text) setItems((all) => all.filter((i) => i.key !== key));
    history.current.push({ role: "assistant", ...(turn.text ? { content: turn.text } : {}), ...(turn.toolCalls.length ? { toolCalls: turn.toolCalls } : {}) });
    return turn.toolCalls;
  }

  /** Runs one tool call and returns what to tell the model. A refusal is told to the model too, so it can explain. */
  async function runCall(call: Call, signal: AbortSignal): Promise<string> {
    const key = add({ kind: "tool", name: humanize(call.name), input: call.arguments, state: "running" });
    const told = (o: ToolOutcome | { state: "failed"; message: string }) => {
      if (o.state === "failed") {
        patch(key, { state: "failed", message: o.message });
        return JSON.stringify({ error: { message: o.message } });
      }
      patch(key, { state: "done" });
      return JSON.stringify((o as { result?: unknown }).result ?? {});
    };
    try {
      let out = await api<ToolOutcome>("/api/pramaan/chat/tool", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ name: call.name, arguments: call.arguments }),
        signal,
      });
      if (out.state !== "failed") patch(key, { name: out.name });
      while (out.state === "waiting") {
        patch(key, { state: "waiting" });
        await sleep(pollMs, signal);
        out = await api<ToolOutcome>(`/api/pramaan/chat/tool?job=${encodeURIComponent(out.job)}`, { signal });
      }
      return told(out);
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      return told({ state: "failed", message: e instanceof ApiError ? e.message : "Something went wrong. Try again." });
    }
  }

  async function send(text: string) {
    const mark = history.current.length;
    const controller = (abort.current = new AbortController());
    history.current.push({ role: "user", content: text });
    add({ kind: "user", text });
    setDraft("");
    setBusy(true);
    setError(undefined);
    setNote(undefined);
    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const calls = await reply(controller.signal);
        if (calls.length === 0) return;
        for (const call of calls) history.current.push({ role: "tool", toolCallId: call.id, content: await runCall(call, controller.signal) });
      }
      setNote("That took more steps than allowed, so it stopped. Ask again to carry on.");
    } catch (e) {
      // Forget the half-finished turn, so the next message starts from a conversation the model can read.
      history.current.length = mark;
      if ((e as Error).name === "AbortError") setNote("Stopped.");
      else setError(e instanceof ApiError ? e : new ApiError("Something went wrong. Try again.", "internal"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Chat" className="flex w-full flex-col gap-3 rounded-xl border bg-card text-card-foreground shadow-sm">
      <div role="log" aria-label="Conversation" aria-live="polite" aria-busy={busy} className="min-h-[320px] max-h-[55vh] flex-1 space-y-3 overflow-y-auto p-4">
        {items.length === 0 && (
          <EmptyState title="Ask anything">Anything that sends or changes something waits for a team member's yes first.</EmptyState>
        )}
        {items.map((i) =>
          i.kind === "tool" ? (
            <div key={i.key} className="pr-card space-y-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <b>{i.name}</b>
                <StatusPill tone={TOOL_WORDS[i.state].tone}>{TOOL_WORDS[i.state].label}</StatusPill>
              </div>
              <InputFields input={i.input} label="What it will do" />
              {i.state === "waiting" && (
                <p className="text-muted-foreground">
                  A team member decides this in the <a className="pr-link" href={approvalsHref}>approvals inbox</a>. The chat carries on after.
                </p>
              )}
              {i.state === "failed" && <p className="text-destructive">{i.message}</p>}
            </div>
          ) : (
            <div key={i.key} className={i.kind === "user" ? "ml-auto max-w-[85%] rounded-2xl bg-primary/10 px-4 py-2 text-sm" : "max-w-[85%] space-y-1 text-sm"}>
              <p className="whitespace-pre-wrap">{i.text || "…"}</p>
              {i.kind === "assistant" && i.cost !== undefined && <p className="text-xs text-muted-foreground">This reply cost {formatMicro(i.cost)}</p>}
            </div>
          ),
        )}
        <div ref={end} />
      </div>

      {(error || note) && (
        <div className="space-y-2 px-4">
          {error && <ErrorState error={error} />}
          <StatusMessage text={note} />
        </div>
      )}

      <form
        className="flex flex-col gap-1 border-t p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && draft.trim()) void send(draft.trim());
        }}
      >
        <Label htmlFor="pramaan-chat-message" className="sr-only">Your message</Label>
        <div className="flex items-stretch gap-2">
          <Textarea
            id="pramaan-chat-message"
            aria-describedby="pramaan-chat-hint"
            placeholder="Write a message"
            className="min-h-0 min-w-0 flex-1 resize-none"
            rows={2}
            value={draft}
            disabled={busy}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends. Shift+Enter is a new line. While an input method is composing, Enter belongs to it.
              if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
              e.preventDefault();
              if (!busy && draft.trim()) e.currentTarget.form?.requestSubmit();
            }}
          />
          <Button type="submit" className="!h-auto" disabled={busy || !draft.trim()}>
            <SendHorizontal aria-hidden className="size-4" />
            Send
          </Button>
          {busy && (
            <Button type="button" variant="outline" className="!h-auto" onClick={() => abort.current?.abort()}>
              Stop
            </Button>
          )}
        </div>
        <p id="pramaan-chat-hint" className="text-xs text-muted-foreground">Enter to send, Shift + Enter for a new line</p>
      </form>
    </section>
  );
}
