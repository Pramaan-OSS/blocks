import "server-only";
import { createHash } from "node:crypto";
import { PramaanError } from "@pramaan/sdk";
import { fakeRows } from "@/lib/pramaan/crm-data";
import { capability } from "@/lib/pramaan/server";
import { moduleResetSender } from "@/lib/pramaan/password-reset-sender";

// One notice email per owner message, under the rules of the email-notices block: it goes only to an
// address the person confirmed, once per event, with a fixed subject. What the owner typed stays in
// the app; only the listing title reaches the email, on one line. No address is stored or logged.
// In a kit with email-notices installed, replace the body of notifyApplicant with its `notify` call.

export type NoticeStatus = "sent" | "not-sent" | "unknown" | "pending";
export type NoticeResult = { status: NoticeStatus; note: string };
const NOT_SENT = "The email wasn't sent. Your message is saved in the app.";
const UNVERIFIED = "This person hasn't confirmed an email address, so nothing was emailed. Your message is saved in the app.";
const OFF = "Email isn't switched on for this app yet. Your message is saved in the app.";
const UNKNOWN = "The email may have been sent. It won't be sent again.";

/** Wire this to your accounts: return the address this person confirmed, never one typed into a form. */
export async function confirmedEmail(person: string, _scope: string): Promise<string | undefined> {
  if (process.env.PRAMAAN_FAKE === "1") return person === "mbr_unconfirmed" ? undefined : "applicant@example.com";
  return undefined;
}
export const noticeKey = (event: string) => `en1-${createHash("sha256").update(`application-message\n${event}`).digest("hex")}`;
export function noticeMail(to: string, listingTitle: string) {
  const title = listingTitle.replace(/\s+/g, " ").trim().slice(0, 60);
  return { to, subject: "You have a message about your application", text: `The owner of the listing "${title}" sent you a message.\n\nSign in and open your applications to read it.` };
}
async function viaCapability(mail: ReturnType<typeof noticeMail>, key: string): Promise<NoticeResult> {
  const from = process.env.PRAMAAN_NOTICE_FROM;
  if (!from) return { status: "not-sent", note: OFF };
  try {
    const sent = await capability<{ status?: string }>("email.send", { ...mail, sender: "domain", from }, { "Idempotency-Key": key });
    return sent.status === "running" ? { status: "pending", note: "This email needs a yes in your approvals before it goes." } : { status: "sent", note: "" };
  } catch (error) {
    // A refusal never left; anything else may have.
    return error instanceof PramaanError && error.status !== undefined && error.status < 500 ? { status: "not-sent", note: NOT_SENT } : { status: "unknown", note: UNKNOWN };
  }
}
/** Never throws: a saved message stands whether or not its email goes. */
export async function notifyApplicant(notice: { scope: string; person: string; event: string; listingTitle: string }): Promise<NoticeResult> {
  try {
    const to = await confirmedEmail(notice.person, notice.scope);
    if (!to) return { status: "not-sent", note: UNVERIFIED };
    const mail = noticeMail(to, notice.listingTitle);
    const key = noticeKey(notice.event);
    const transport = process.env.PRAMAAN_NOTICE_TRANSPORT ?? "module";
    if (transport === "capability") return await viaCapability(mail, key);
    if (process.env.PRAMAAN_FAKE === "1") { fakeRows<typeof mail & { key: string }>("crm_notice_outbox").push({ ...mail, key }); return { status: "sent", note: "" }; }
    const outcome = await moduleResetSender().send(mail, key);
    return outcome === "accepted" ? { status: "sent", note: "" } : outcome === "unknown" ? { status: "unknown", note: UNKNOWN } : { status: "not-sent", note: OFF };
  } catch { return { status: "not-sent", note: NOT_SENT }; }
}
