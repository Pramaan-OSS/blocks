import { revokeInvitation } from "@/lib/pramaan/assessment";
import { errorResponse } from "@/lib/pramaan/server";

export async function POST(request: Request, { params }: { params: Promise<{ ref: string }> }) {
  try {
    const key = request.headers.get("Idempotency-Key") ?? crypto.randomUUID();
    return Response.json(await revokeInvitation((await params).ref, key));
  } catch (error) {
    return errorResponse(error);
  }
}
