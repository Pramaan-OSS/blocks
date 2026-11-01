import { invite, listInvitations } from "@/lib/pramaan/assessment";
import { errorResponse } from "@/lib/pramaan/server";

export async function GET(_request: Request, { params }: { params: Promise<{ ref: string }> }) {
  try {
    return Response.json(await listInvitations((await params).ref));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ ref: string }> }) {
  try {
    const key = request.headers.get("Idempotency-Key") ?? crypto.randomUUID();
    return Response.json(await invite((await params).ref, await request.json().catch(() => ({})), key), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
