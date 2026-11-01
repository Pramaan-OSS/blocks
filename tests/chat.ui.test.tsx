// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Chat } from "@/components/pramaan/chat/chat-panel";
import { readTurn } from "@/components/pramaan/chat/stream";
import { decideElsewhere, failNext, fakeState, resetFake } from "@/lib/pramaan/fake";
import { appFetch } from "./harness";

beforeEach(() => {
  resetFake();
  vi.stubGlobal("fetch", appFetch("mbr_owner"));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const say = async (text: string) => {
  await userEvent.type(screen.getByLabelText("Your message"), text);
  await userEvent.click(screen.getByRole("button", { name: "Send" }));
};
const bytes = (s: string) => new ReadableStream<Uint8Array>({ start: (c) => (c.enqueue(new TextEncoder().encode(s)), c.close()) });

describe("Chat", () => {
  it("shows your message and the streamed reply with what it cost, and no ids", async () => {
    render(<Chat />);
    expect(screen.getByText("Ask anything")).toBeTruthy();
    await say("hello there");
    expect(await screen.findByText("You said: hello there")).toBeTruthy();
    expect(screen.getByText("This reply cost under $0.01")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/tc_FAKE|apr_|llm\.chat|\{|"/);
  });

  it("an email waits for a yes with its exact details, then the chat carries on after approval", async () => {
    render(<Chat approvalsHref="/inbox" pollMs={20} />);
    await say("Email lee@example.com please");
    expect(await screen.findByText("Waiting for a yes")).toBeTruthy();
    expect(screen.getByText("Send an email")).toBeTruthy();
    expect(screen.getByText("lee@example.com")).toBeTruthy();
    expect(screen.getByRole("link", { name: "approvals inbox" }).getAttribute("href")).toBe("/inbox");
    const pending = [...fakeState().approvals.values()].find((a) => (a.input as { to?: string }).to === "lee@example.com")!;
    expect(pending.runs).toBe(0);
    decideElsewhere(pending.id, "approved", "mbr_owner");
    expect(await screen.findByText("Done. The email is on its way.")).toBeTruthy();
    expect(screen.getByText("Done")).toBeTruthy();
    expect(pending.runs).toBe(1);
  });

  it("a declined email is told to the assistant, which explains in its own words", async () => {
    render(<Chat pollMs={20} />);
    await say("Email lee@example.com please");
    await screen.findByText("Waiting for a yes");
    const pending = [...fakeState().approvals.values()].find((a) => (a.input as { to?: string }).to === "lee@example.com")!;
    decideElsewhere(pending.id, "denied", "mbr_owner");
    expect(await screen.findByText(/That didn't go through: A member declined this call/)).toBeTruthy();
    expect(screen.getByText("Didn't run")).toBeTruthy();
  });

  it("a failed reply shows the server's message, and the next message starts clean", async () => {
    failNext("POST", "/v1/capabilities/llm.chat", 502, { code: "upstream_unavailable", message: "The assistant is busy." });
    render(<Chat />);
    await say("first");
    expect(await screen.findByText("The assistant is busy.")).toBeTruthy();
    await say("second");
    expect(await screen.findByText("You said: second")).toBeTruthy();
    const sent = fakeState().requests.filter((r) => r.path.endsWith("llm.chat")).pop()!.body as { messages: { role: string }[] };
    expect(sent.messages.map((m) => m.role)).toEqual(["system", "user"]);
  });

  it("signed out: asks the person to sign in", async () => {
    vi.stubGlobal("fetch", appFetch("none"));
    render(<Chat />);
    await say("hello");
    expect(await screen.findByText("Sign in to see this.")).toBeTruthy();
  });

  it("shows the send hint under the box", () => {
    render(<Chat />);
    expect(screen.getByText("Enter to send, Shift + Enter for a new line")).toBeTruthy();
  });

  it("Enter sends the message and clears the box", async () => {
    render(<Chat />);
    const box = screen.getByLabelText("Your message") as HTMLTextAreaElement;
    await userEvent.type(box, "hi{Enter}");
    expect(await screen.findByText("You said: hi")).toBeTruthy();
    expect(box.value).toBe("");
  });

  it("Shift+Enter adds a new line and does not send", async () => {
    render(<Chat />);
    const box = screen.getByLabelText("Your message") as HTMLTextAreaElement;
    await userEvent.type(box, "one{Shift>}{Enter}{/Shift}two");
    expect(box.value).toBe("one\ntwo");
    expect(screen.getByText("Ask anything")).toBeTruthy();
  });

  it("Enter on an empty or whitespace-only box does not send, and Send stays off", async () => {
    render(<Chat />);
    const box = screen.getByLabelText("Your message") as HTMLTextAreaElement;
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(box, "{Enter}");
    await userEvent.type(box, "   {Enter}");
    expect(box.value).toBe("   ");
    expect(screen.getByText("Ask anything")).toBeTruthy();
  });

  it("Enter while an input method is composing does not send", () => {
    render(<Chat />);
    const box = screen.getByLabelText("Your message") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "nihao" } });
    fireEvent.keyDown(box, { key: "Enter", isComposing: true });
    expect(screen.getByText("Ask anything")).toBeTruthy();
    expect(box.value).toBe("nihao");
  });
});

describe("readTurn", () => {
  const f = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

  it("reads frames split anywhere, including inside a multi-byte character, and ignores pings", async () => {
    const all = new TextEncoder().encode(`: ping\n\n${f("text_delta", { text: "Hél" })}${f("text_delta", { text: "lo" })}${f("done", { finishReason: "stop", result: { text: "Héllo", toolCalls: [] }, price_micro: 2600 })}`);
    const seen: string[] = [];
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < all.length; i += 3) c.enqueue(all.slice(i, i + 3));
        c.close();
      },
    });
    const turn = await readTurn(body, (t) => seen.push(t));
    expect(seen).toEqual(["Hél", "Héllo"]);
    expect(turn).toEqual({ text: "Héllo", toolCalls: [], priceMicro: 2600 });
  });

  it("builds tool calls from the pieces when the finished result has none", async () => {
    const turn = await readTurn(bytes(f("tool_call_start", { index: 0, id: "t1", name: "send_email" }) + f("tool_call_delta", { index: 0, arguments: '{"to":' }) + f("tool_call_delta", { index: 0, arguments: '"a@b.co"}' }) + f("done", { finishReason: "tool_calls" })), () => {});
    expect(turn.toolCalls).toEqual([{ id: "t1", name: "send_email", arguments: { to: "a@b.co" } }]);
  });

  it("an error event and a stream that stops early both say so in plain words", async () => {
    await expect(readTurn(bytes(f("error", { message: "The assistant is busy." })), () => {})).rejects.toThrow("The assistant is busy.");
    await expect(readTurn(bytes(f("text_delta", { text: "Half" })), () => {})).rejects.toThrow("The reply stopped before it finished. Try again.");
  });
});
