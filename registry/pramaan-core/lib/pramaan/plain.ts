// Plain wording for every screen: names, labels, dates. No ids, no snake_case, no raw JSON reach a
// person through these helpers. Pure functions, safe in the browser and on the server.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "31 Oct, 8:03 PM" (and the year when it isn't this year). `time: false` gives "31 Oct". */
export function formatDate(value: string | number | Date | undefined, opts: { time?: boolean } = {}): string {
  if (value === undefined || value === "") return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const year = d.getFullYear() === new Date().getFullYear() ? "" : ` ${d.getFullYear()}`;
  const day = `${d.getDate()} ${MONTHS[d.getMonth()]}${year}`;
  if (opts.time === false) return day;
  const h = d.getHours() % 12 || 12;
  return `${day}, ${h}:${String(d.getMinutes()).padStart(2, "0")} ${d.getHours() < 12 ? "AM" : "PM"}`;
}

/** A calendar day ("2026-10-30") as "30 Oct". */
export function formatDay(day: string, withYear = true): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  if (!m) return day;
  const year = !withYear || Number(m[1]) === new Date().getFullYear() ? "" : ` ${m[1]}`;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}${year}`;
}

/** Cents as money: 2000 and "usd" is "$20.00". */
export const formatCents = (cents: number, currency = "usd") => new Intl.NumberFormat("en", { style: "currency", currency }).format(cents / 100);

const cap = (s: string) => s.replace(/^./, (c) => c.toUpperCase());

/** "snake_case", "camelCase" and "kebab-case" as plain words: "Account name". */
export const humanize = (key: string) => cap(key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim().toLowerCase());

// Plain names for what ran. Others are built from the id's words, verb first.
const ACTIONS: Record<string, string> = {
  "email.send": "Send an email",
  "sms.send": "Send a text message",
  "social.post.publish": "Publish a social post",
  "payments.payout.create": "Send a payout",
  "voice.call.start": "Make a phone call",
  "apps.connection.delete": "Remove a connected account",
  "company.research": "Research a company",
  "broadcast.send": "Send a broadcast",
  "llm.complete": "Write with AI",
  "llm.chat": "Chat with AI",
  "web.read": "Read a web page",
  "web.search": "Search the web",
  "companies.news": "Find company news",
  "companies.registry.search": "Look up a company register",
  "outreach.contacts.list": "List contacts",
  "outreach.broadcast.create": "Create a broadcast",
  "outreach.broadcast.send": "Send a broadcast",
  "assessment.exam.build": "Build an exam",
  "assessment.exam.publish": "Publish an exam",
  "assessment.invitation.create": "Invite a candidate",
  "assessment.invitation.revoke": "Withdraw an invitation",
  "assessment.invite.send": "Invite candidates",
  "assessment.invites.clean-up": "Clean up unused invitations",
  "memory.forget": "Forget everything",
  "memory.item.delete": "Delete a memory",
  "messaging.opt-out.add": "Add an opt-out",
  "messaging.opt-out.remove": "Remove an opt-out",
};

const VERBS = new Set([
  "send", "create", "get", "list", "build", "research", "publish", "delete", "revoke", "start", "run", "check", "add",
  "remove", "search", "read", "write", "post", "call", "close", "update", "invite", "finish", "complete", "record",
  "upload", "download", "connect", "forget", "decide", "estimate", "cancel", "summarize",
]);

/** A capability or mission id as a plain action: "company.research" is "Research a company". */
export function actionName(id: string): string {
  if (ACTIONS[id]) return ACTIONS[id];
  const words = id.split(/[._-]+/).filter(Boolean);
  const last = words[words.length - 1];
  if (words.length > 1 && last && VERBS.has(last)) return cap([last, ...words.slice(0, -1)].join(" "));
  return cap(words.join(" "));
}

/** Who asked, in words a person uses. Never a member id. */
export function requesterLabel(r: { kind: string; act?: string; member_id?: string }): string {
  if (r.member_id) return "A team member";
  if (r.kind === "key") return "Your app";
  return r.act === "agent" ? "An AI assistant" : "An app";
}

// Plain names for common input keys; anything else comes from humanize().
const LABELS: Record<string, string> = {
  to: "To", cc: "Copy to", bcc: "Hidden copy to", from: "From", subject: "Subject", text: "Message", body: "Message",
  html: "Message", amount_micro: "Amount", phone: "Phone", url: "Link", q: "Search for", query: "Search for",
  accountId: "Account", prompt: "What to write", maxWords: "Longest answer (words)",

};

export const fieldLabel = (key: string) => LABELS[key] ?? humanize(key);

/** An internal id (`mbr_viewer`, `apr_x1`, `acc_mail1`): shown only behind a Copy reference control. */
/** A file size in plain units: "3.2 MB". */
export const formatBytes = (n: number) => (n < 1_000 ? `${n} B` : n < 1_000_000 ? `${(n / 1_000).toFixed(0)} KB` : n < 1_000_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${(n / 1_000_000_000).toFixed(1)} GB`);

export const looksLikeId = (v: unknown): v is string => typeof v === "string" && /^[a-z]{2,6}_[A-Za-z0-9_-]{3,}$/.test(v);

// Developer wording that must never reach a person: keys, headers, env vars, status codes, ids.
const DEV_WORDS = /api[ -]?key|authorization|\bheaders?\b|PRAMAAN_[A-Z_]+|idempotency|retry-after|request[_ ]id|\bHTTP \d{3}\b|\b(?:answered|status)(?: with)? \d{3}\b|support@|apps\.connection/i;
const SETUP = "Ask whoever runs this app to check its setup.";

/**
 * An error's message and next step as a person should read them. Local signed-out errors keep
 * their own words; anything that names a key, header, env var or status code is replaced.
 */
export function plainProblem(code: string, status: number | undefined, message: string, next?: string): { message: string; next?: string } {
  if (code === "signed_out") return { message: "Sign in to see this.", ...(next && !DEV_WORDS.test(next) ? { next } : {}) };
  if (code === "unauthorized") return { message: "This app can't reach its service right now.", next: SETUP };
  const fallback = status === 404 ? "We couldn't find that." : status && status >= 500 ? "Something went wrong on our side. Try again in a minute." : status ? "That didn't work. Try again." : "Something went wrong. Try again.";
  const clean = DEV_WORDS.test(message) || /^(?:the )?(?:api|server|pramaan) answered/i.test(message) ? fallback : message;
  const step = next === undefined ? undefined : DEV_WORDS.test(next) ? (code === "connection_required" ? SETUP : undefined) : next;
  return { message: clean, ...(step ? { next: step } : {}) };
}

const STATE_WORDS: Record<string, string> = {
  running: "Running", done: "Done", failed: "Failed", cancelled: "Cancelled", pending: "Waiting", waiting: "Waiting",
  waiting_for_approval: "Waiting for approval", approved: "Approved", denied: "Declined", expired: "Expired",
};

/** A status word as plain text: "waiting_for_approval" is "Waiting for approval". */
export const stateWord = (s: string) => STATE_WORDS[s] ?? humanize(s);
