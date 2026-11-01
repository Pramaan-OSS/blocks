import { errorResponse } from "@/lib/pramaan/server";
import { openPortal } from "@/lib/pramaan/subscriptions";

// Makes a short-lived link to the hosted billing page for the signed-in customer.
export async function POST(request: Request) {
  try {
    return Response.json(await openPortal(request, await request.json().catch(() => ({}))));
  } catch (error) {
    return errorResponse(error);
  }
}
