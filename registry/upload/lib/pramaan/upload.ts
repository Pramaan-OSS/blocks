import "server-only";
import { PramaanError } from "@pramaan/sdk";
import { pramaan } from "@/lib/pramaan/server";

// Server half of the upload block: starts a direct upload (the browser then sends the bytes straight
// to storage, so large files never pass through this app), checks the file once it has arrived,
// lists what was uploaded, and deletes a file. Calls POST /v1/files/uploads, POST /v1/files/{id}/finish,
// GET /v1/files and DELETE /v1/files/{id}.

export type FileKind = "image" | "audio" | "video" | "document" | "data";

export interface UploadLink {
  readonly fileId: string;
  /** Where the browser sends the bytes with a PUT. Valid for 15 minutes. */
  readonly uploadUrl: string;
  /** Send exactly these headers with the PUT. */
  readonly headers: Record<string, string>;
}
export interface StoredFile {
  readonly fileId: string;
  readonly kind: FileKind;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly createdAt: string;
  /** When the file is deleted. */
  readonly expiresAt: string;
  /** A link to open the file; it stops working at `expiresAt`. */
  readonly url?: string;
}

const bad = (message: string) => new PramaanError("invalid_request", message, { status: 400 });
const FILE_ID = /^file_[0-9A-HJKMNP-TV-Z]{26}$/;
/** The API's direct-upload limits, in bytes. */
export const LIMITS: Record<FileKind, number> = { image: 20e6, audio: 100e6, document: 100e6, data: 100e6, video: 500e6 };

/** What kind of file a media type is, or undefined when the app doesn't take it. */
export function kindOf(contentType: string): FileKind | undefined {
  const t = contentType.toLowerCase().split(";")[0].trim();
  if (/^(image|audio|video)\/[\w.+-]+$/.test(t)) return t.split("/")[0] as FileKind;
  if (t === "application/pdf") return "document";
  return ["text/csv", "application/json", "text/plain"].includes(t) ? "data" : undefined;
}

const id = (v: unknown) => {
  if (typeof v !== "string" || !FILE_ID.test(v)) throw bad("That file couldn't be found.");
  return v;
};

/** Starts one upload. `contentType` and `sizeBytes` come from the browser's File. */
export async function startUpload(body: { contentType?: unknown; sizeBytes?: unknown }): Promise<UploadLink> {
  const contentType = typeof body.contentType === "string" ? body.contentType : "";
  const kind = kindOf(contentType);
  if (!kind) throw bad("That type of file isn't supported. Use an image, audio, video, PDF, CSV, JSON or text file.");
  const size = body.sizeBytes;
  if (typeof size !== "number" || !Number.isInteger(size) || size < 1) throw bad("That file is empty.");
  if (size > LIMITS[kind]) throw bad(`That file is too large. The most for this kind of file is ${LIMITS[kind] / 1e6} MB.`);
  const r = await pramaan<UploadLink>("/v1/files/uploads", { method: "POST", body: { kind, contentType, sizeBytes: size } });
  return { fileId: r.fileId, uploadUrl: r.uploadUrl, headers: r.headers };
}

/** Checks the bytes that arrived and makes the file ready to use. */
export const finishUpload = (fileId: unknown) =>
  pramaan<StoredFile>(`/v1/files/${encodeURIComponent(id(fileId))}/finish`, { method: "POST", body: {} });

/** Files you uploaded, newest first. */
export const listUploads = () => pramaan<{ results: StoredFile[] }>("/v1/files?origin=upload&limit=100");

/** Deletes a file now. Its links stop working at once. */
export const deleteUpload = (fileId: unknown) =>
  pramaan<{ deleted: true }>(`/v1/files/${encodeURIComponent(id(fileId))}`, { method: "DELETE" });
