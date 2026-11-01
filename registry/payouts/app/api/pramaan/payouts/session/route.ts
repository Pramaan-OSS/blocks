import { openSession } from "@/lib/pramaan/payouts";
import { errorResponse } from "@/lib/pramaan/server";

// The secret in the answer is for the signed-in owner's browser only. Don't log this response.
export async function POST(request: Request) {
  try {
    return Response.json(await openSession(request, await request.json().catch(() => ({}))), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
