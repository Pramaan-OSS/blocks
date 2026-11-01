import { startMission } from "@/lib/pramaan/missions";
import { errorResponse } from "@/lib/pramaan/server";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const key = request.headers.get("Idempotency-Key") ?? crypto.randomUUID();
    const body = await request.json().catch(() => ({}));
    return Response.json(await startMission((await params).id, body, key), { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
