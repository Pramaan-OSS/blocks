import { runChoice } from "@/lib/pramaan/picker";
import { errorResponse } from "@/lib/pramaan/server";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const body = (await request.json().catch(() => ({}))) as { input?: unknown };
    return Response.json(await runChoice((await params).id, body.input, request.headers.get("Idempotency-Key") ?? crypto.randomUUID()));
  } catch (error) {
    return errorResponse(error);
  }
}
