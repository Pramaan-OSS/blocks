import "server-only";
import { PramaanError } from "@pramaan/sdk";
import { capability } from "@/lib/pramaan/server";

// Server half of the e-sign block: sends one document to be signed by email, lists what was sent,
// reads who has signed, sends a reminder, and gets the signed copy. Calls signature.request.send,
// signature.requests.list, signature.request.get, signature.request.remind and
// signature.request.download. The signers sign on the signing service's own page, opened from the
// email; this app never sees their signature.

export type SigningState = "preparing" | "waiting" | "opened" | "partly" | "signed" | "declined" | "cancelled" | "expired" | "failed" | "unknown";
export type SignerState = "waiting" | "opened" | "signed" | "declined" | "expired" | "unknown";

export interface SigningRow {
  /** An opaque handle for the later calls. Keep it in the browser; never show it. */
  readonly ref: string;
  readonly title: string;
  readonly state: SigningState;
  readonly createdAt?: string;
}
export interface SigningDetail {
  readonly title: string;
  readonly state: SigningState;
  readonly createdAt?: string;
  readonly completedAt?: string;
  readonly signers: readonly { name: string; email: string; state: SignerState; signedAt?: string }[];
  readonly downloadable: boolean;
}

const bad = (message: string) => new PramaanError("invalid_request", message, { status: 400 });
const REF = /^ref_[A-Za-z0-9_-]{3,120}$/;
const FILE_ID = /^file_[0-9A-HJKMNP-TV-Z]{26}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const STATE: Record<string, SigningState> = {
  draft: "preparing", preparing: "preparing", sent: "waiting", viewed: "opened", "partially-signed": "partly",
  completed: "signed", declined: "declined", "cancellation-requested": "cancelled", cancelled: "cancelled",
  expired: "expired", failed: "failed",
};
const SIGNER: Record<string, SignerState> = { waiting: "waiting", viewed: "opened", signed: "signed", declined: "declined", expired: "expired" };

const ref = (v: unknown) => {
  if (typeof v !== "string" || !REF.test(v)) throw bad("That agreement couldn't be found. Pick one from the list.");
  return v;
};

/** What the app lets people send. Replace with your own documents, or take the file id from the upload block. */
export interface SendBody { title?: unknown; fileId?: unknown; filename?: unknown; signers?: unknown }

/**
 * Sends one document to be signed. Each signer gets one signature box at the foot of page 1, one
 * above the other. A held-for-approval answer (the call waits for a member's yes) is passed on as `waiting`.
 */
export async function sendForSignature(request: Request, body: SendBody): Promise<{ ref?: string; needsApproval: boolean }> {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title || title.length > 100) throw bad("Give the agreement a title of up to 100 characters.");
  if (typeof body.fileId !== "string" || !FILE_ID.test(body.fileId)) throw bad("Choose a document to send.");
  const filename = typeof body.filename === "string" ? body.filename.trim() : "";
  if (!/^[^/\\]{1,200}\.(pdf|png|jpe?g)$/i.test(filename)) throw bad("The document must be a PDF, PNG or JPEG file.");
  const list = Array.isArray(body.signers) ? (body.signers as { name?: unknown; email?: unknown }[]) : [];
  if (list.length < 1 || list.length > 20) throw bad("Add 1 to 20 people to sign.");
  const signers = list.map((s, i) => {
    const name = typeof s?.name === "string" ? s.name.trim() : "";
    const email = typeof s?.email === "string" ? s.email.trim() : "";
    if (!name || name.length > 100) throw bad(`Signer ${i + 1} needs a name.`);
    if (!EMAIL.test(email) || email.length > 254) throw bad(`Signer ${i + 1}'s email address doesn't look right.`);
    return { id: `signer_${i + 1}`, name, email };
  });
  if (new Set(signers.map((s) => s.email.toLowerCase())).size !== signers.length) throw bad("Each person needs a different email address.");
  const key = request.headers.get("idempotency-key") ?? undefined;
  const res = await capability<{ ref?: string; approval_id?: string }>(
    "signature.request.send",
    {
      title,
      subject: `Please sign: ${title}`,
      documents: [{ id: "document", fileId: body.fileId, filename }],
      signers,
      fields: signers.map((s, i) => ({ name: "Signature", type: "signature", documentId: "document", signerId: s.id, page: 1, x: 100, y: 100 + i * 80 })),
    },
    key ? { "Idempotency-Key": key } : undefined,
  );
  return res.approval_id && !res.ref ? { needsApproval: true } : { ref: res.ref, needsApproval: false };
}

/** Agreements you sent, newest first. */
export async function listSignings(): Promise<{ results: SigningRow[] }> {
  const res = await capability<{ results: { ref: string; title: string; status: string; createdAt?: string }[] }>("signature.requests.list", { limit: 50 });
  return { results: res.results.map((r) => ({ ref: r.ref, title: r.title, state: STATE[r.status] ?? "unknown", createdAt: r.createdAt })) };
}

export async function getSigning(id: unknown): Promise<SigningDetail> {
  const r = await capability<{
    title: string; status: string; createdAt?: string; completedAt?: string; downloadable?: boolean;
    signers?: { name: string; email: string; status: string; signedAt?: string }[];
  }>("signature.request.get", { ref: ref(id), includeSigners: true });
  const state = STATE[r.status] ?? "unknown";
  return {
    title: r.title, state, createdAt: r.createdAt, completedAt: r.completedAt,
    signers: (r.signers ?? []).map((s) => ({ name: s.name, email: s.email, state: SIGNER[s.status] ?? "unknown", signedAt: s.signedAt })),
    downloadable: state === "signed" && r.downloadable !== false,
  };
}

/** Emails one signer who hasn't signed yet. Checked here first so the wrong person is never emailed. */
export async function remindSigner(id: unknown, email: unknown): Promise<{ ok: true }> {
  if (typeof email !== "string" || !EMAIL.test(email)) throw bad("Choose who to remind.");
  const detail = await getSigning(id);
  const who = detail.signers.find((s) => s.email.toLowerCase() === email.toLowerCase());
  if (!who) throw bad("That person isn't on this agreement.");
  if (who.state === "signed") throw bad(`${who.name} has already signed.`);
  if (who.state === "declined" || who.state === "expired" || detail.state === "cancelled") throw bad("This agreement can't take a reminder any more.");
  await capability("signature.request.remind", { ref: ref(id), signerEmail: who.email, confirm: true });
  return { ok: true };
}

/** A link to the signed copy, once everyone has signed. The link stops working after a while. */
export async function signedCopy(id: unknown): Promise<{ url: string }> {
  const r = await capability<{ file: { url: string } }>("signature.request.download", { ref: ref(id), format: "pdf" });
  return { url: r.file.url };
}
