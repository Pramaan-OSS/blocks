// What the assistant may do for the person, and how it talks. Edit this file. The browser never
// sends a tool or a system message: it can only ask for one of these by name, so a visitor can't
// make the assistant call anything you didn't list here.

export interface ChatTool {
  /** The Pramaan action this tool runs. */
  readonly capability: string;
  /** Tells the model when to use it. */
  readonly description: string;
  /** The arguments, as a JSON Schema object. */
  readonly parameters: Record<string, unknown>;
}

export const CHAT_SYSTEM =
  "You are a helpful assistant inside this app. Answer briefly, in plain words. Use a tool only when the person asks you to do that thing, and say what you are about to do first.";

/** `fast`, `balanced` or `best`. */
export const CHAT_MODEL = "fast";

export const CHAT_TOOLS: Record<string, ChatTool> = {
  send_email: {
    capability: "email.send",
    description: "Send one email for the person. A team member must approve it before it goes.",
    parameters: {
      type: "object",
      required: ["to", "subject", "text"],
      properties: { to: { type: "string" }, subject: { type: "string" }, text: { type: "string" } },
    },
  },
  search_web: {
    capability: "web.search",
    description: "Search the web for the person and return the top results.",
    parameters: { type: "object", required: ["query"], properties: { query: { type: "string" } } },
  },
};
