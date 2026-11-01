import { beforeEach, describe, expect, it } from "vitest";
import { fakeState, resetFake } from "@/lib/pramaan/fake";
import { DEMO_DOCUMENT_ID, fakeReminders, holdFakeSignatureSend, signFakeSignature, viewFakeSignature } from "@/lib/pramaan/fake-wave3";
import { get, post } from "./harness";

beforeEach(() => resetFake());

const calls = (id: string) => fakeState().requests.filter((r) => r.path === `/v1/capabilities/${id}`);
const send = (over: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  post(undefined, "/api/pramaan/signing", {
    title: "Service agreement", fileId: DEMO_DOCUMENT_ID, filename: "agreement.pdf",
    signers: [{ name: "Pat Lee", email: "pat@example.com" }, { name: "Sam Roy", email: "sam@example.com" }], ...over,
  }, headers);
const refOf = async () => ((await (await send()).json()) as { ref: string }).ref;
const detail = async (ref: string) => (await (await get(undefined, `/api/pramaan/signing/${ref}`)).json()) as { state: string; downloadable: boolean; signers: { email: string; state: string }[] };

describe("e-sign server half", () => {
  it("sends the document with a signature box per signer and the click's key", async () => {
    const res = await send({}, { "Idempotency-Key": "click-1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ needsApproval: false, ref: expect.stringMatching(/^ref_/) });
    const sent = calls("signature.request.send")[0];
    expect(sent.headers["idempotency-key"]).toBe("click-1");
    const body = sent.body as { documents: unknown[]; fields: { signerId: string; y: number }[]; signers: { id: string }[] };
    expect(body.documents).toEqual([{ id: "document", fileId: DEMO_DOCUMENT_ID, filename: "agreement.pdf" }]);
    expect(body.fields.map((f) => f.signerId)).toEqual(body.signers.map((s) => s.id));
    expect(new Set(body.fields.map((f) => f.y)).size).toBe(2);
  });

  it("refuses bad input before any call", async () => {
    for (const [over, words] of [
      [{ title: "" }, "title"],
      [{ fileId: "nope" }, "Choose a document"],
      [{ filename: "notes.txt" }, "PDF"],
      [{ signers: [] }, "1 to 20"],
      [{ signers: [{ name: "", email: "a@b.co" }] }, "needs a name"],
      [{ signers: [{ name: "A", email: "nope" }] }, "email address"],
      [{ signers: [{ name: "A", email: "a@b.co" }, { name: "B", email: "A@b.co" }] }, "different email"],
    ] as const) {
      const res = await send(over);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: { message: string } }).error.message).toContain(words);
    }
    expect(calls("signature.request.send")).toHaveLength(0);
  });

  it("passes on a call held for approval as waiting, with no reference", async () => {
    holdFakeSignatureSend(fakeState());
    const res = await send();
    expect(await res.json()).toEqual({ needsApproval: true });
    expect((await (await get(undefined, "/api/pramaan/signing")).json()) as { results: unknown[] }).toEqual({ results: [] });
  });

  it("lists agreements newest first and moves through waiting, opened, partly, signed", async () => {
    const ref = await refOf();
    expect((await (await get(undefined, "/api/pramaan/signing")).json()) as { results: { title: string; state: string }[] }).toMatchObject({ results: [{ title: "Service agreement", state: "waiting" }] });
    viewFakeSignature(fakeState(), ref, "pat@example.com");
    expect((await detail(ref)).state).toBe("opened");
    signFakeSignature(fakeState(), ref, "pat@example.com");
    expect(await detail(ref)).toMatchObject({ state: "partly", downloadable: false });
    signFakeSignature(fakeState(), ref, "sam@example.com");
    expect(await detail(ref)).toMatchObject({ state: "signed", downloadable: true });
  });

  it("reminds only a signer who hasn't signed", async () => {
    const ref = await refOf();
    signFakeSignature(fakeState(), ref, "pat@example.com");
    const r = (email: string) => post(undefined, `/api/pramaan/signing/${ref}/remind`, { email });
    expect((await r("sam@example.com")).status).toBe(200);
    expect(fakeReminders(fakeState(), ref)).toBe(1);
    expect(calls("signature.request.remind")[0].body).toMatchObject({ signerEmail: "sam@example.com", confirm: true });
    const signed = await r("pat@example.com");
    expect(signed.status).toBe(400);
    expect(((await signed.json()) as { error: { message: string } }).error.message).toContain("already signed");
    expect((await r("stranger@example.com")).status).toBe(400);
    expect((await r("nope")).status).toBe(400);
    expect(calls("signature.request.remind")).toHaveLength(1);
  });

  it("gives the signed copy only when everyone has signed, and passes the API's refusal on", async () => {
    const ref = await refOf();
    const early = await get(undefined, `/api/pramaan/signing/${ref}/download`);
    expect(early.status).toBe(409);
    expect(((await early.json()) as { error: { message: string } }).error.message).toContain("isn't fully signed");
    for (const e of ["pat@example.com", "sam@example.com"]) signFakeSignature(fakeState(), ref, e);
    const ok = await get(undefined, `/api/pramaan/signing/${ref}/download`);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { url: string }).url).toMatch(/^data:application\/pdf/);
  });

  it("refuses a bad reference and names no provider", async () => {
    const res = await get(undefined, "/api/pramaan/signing/not-a-ref");
    expect(res.status).toBe(400);
    const ref = await refOf();
    const text = JSON.stringify([await detail(ref), await (await get(undefined, "/api/pramaan/signing")).json()]);
    expect(text).not.toMatch(/docusign|dropbox|digio|setu/i);
  });
});
