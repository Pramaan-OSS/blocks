import { fakeState } from "@/lib/pramaan/fake";
import { fakeUploadBytes, storeFakeUpload } from "@/lib/pramaan/fake-wave3";

// Demo only: stands in for the storage link the browser sends the file to. Shown when PRAMAAN_FAKE=1.
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (process.env.PRAMAAN_FAKE !== "1") return new Response(null, { status: 404 });
  const ok = storeFakeUpload(fakeState(), (await params).id, new Uint8Array(await request.arrayBuffer()));
  return new Response(null, { status: ok ? 200 : 404 });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (process.env.PRAMAAN_FAKE !== "1") return new Response(null, { status: 404 });
  const f = fakeUploadBytes(fakeState(), (await params).id);
  return f ? new Response(f.bytes as BodyInit, { headers: { "Content-Type": f.contentType } }) : new Response(null, { status: 404 });
}
