import { beforeEach, describe, expect, it } from "vitest";
import { fakeState, resetFake } from "@/lib/pramaan/fake";
import { storeFakeUpload } from "@/lib/pramaan/fake-wave3";
import { callRoute, get, post } from "./harness";

beforeEach(() => resetFake());

const calls = (path: string) => fakeState().requests.filter((r) => r.path === path);
const msg = async (res: Response) => ((await res.json()) as { error: { message: string } }).error.message;
type Link = { fileId: string; uploadUrl: string; headers: Record<string, string> };
const start = async (over: Record<string, unknown> = {}) => (await post(undefined, "/api/pramaan/uploads", { ...{ contentType: "application/pdf", sizeBytes: 5 }, ...over })).json() as Promise<Link>;
const finish = (id: string) => post(undefined, `/api/pramaan/uploads/${id}/finish`);
const list = async () => ((await (await get(undefined, "/api/pramaan/uploads")).json()) as { results: { fileId: string; kind: string }[] }).results;

describe("upload server half", () => {
  it("starts a direct upload with the kind worked out from the media type", async () => {
    const link = await start({ contentType: "image/png" });
    expect(link.fileId).toMatch(/^file_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(link.uploadUrl).toContain(link.fileId);
    expect(calls("/v1/files/uploads")[0].body).toEqual({ kind: "image", contentType: "image/png", sizeBytes: 5 });
  });

  it("refuses unsupported types, empty files and files over the limit before any call", async () => {
    for (const [over, words] of [
      [{ contentType: "application/zip", sizeBytes: 5 }, "isn't supported"],
      [{ contentType: "" }, "isn't supported"],
      [{ sizeBytes: 0 }, "empty"],
      [{ sizeBytes: 1.5 }, "empty"],
      [{ contentType: "image/png", sizeBytes: 21_000_000 }, "too large"],
    ] as const) {
      const res = await post(undefined, "/api/pramaan/uploads", Object.assign({ contentType: "application/pdf" }, over));
      expect(res.status).toBe(400);
      expect(await msg(res)).toContain(words);
    }
    expect(calls("/v1/files/uploads")).toHaveLength(0);
  });

  it("makes a file ready only once its bytes arrived in full, then lists it", async () => {
    const link = await start();
    expect(await list()).toEqual([]);
    const early = await finish(link.fileId);
    expect(early.status).toBe(400);
    expect(await msg(early)).toContain("didn't arrive in full");
    storeFakeUpload(fakeState(), link.fileId, new Uint8Array(4));
    expect((await finish(link.fileId)).status).toBe(400);
    storeFakeUpload(fakeState(), link.fileId, new Uint8Array(5));
    const ok = await finish(link.fileId);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ fileId: link.fileId, kind: "document", sizeBytes: 5 });
    expect((await list()).map((f) => f.fileId)).toEqual([link.fileId]);
  });

  it("deletes a file, and says so plainly for one that is gone or isn't a file id", async () => {
    const link = await start();
    storeFakeUpload(fakeState(), link.fileId, new Uint8Array(5));
    await finish(link.fileId);
    const del = (id: string) => callRoute(new Request(`http://app.test/api/pramaan/uploads/${id}`, { method: "DELETE" }));
    expect((await del(link.fileId)).status).toBe(200);
    expect(await list()).toEqual([]);
    const again = await del(link.fileId);
    expect(again.status).toBe(404);
    expect(await msg(again)).toBe("File not found.");
    const odd = await del("nope");
    expect(odd.status).toBe(400);
    expect(await msg(odd)).toContain("couldn't be found");
    expect((await finish("nope")).status).toBe(400);
  });
});
