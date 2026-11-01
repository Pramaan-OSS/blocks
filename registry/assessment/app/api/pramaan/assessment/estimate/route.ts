import { estimateAction } from "@/lib/pramaan/assessment";
import { errorResponse } from "@/lib/pramaan/server";

export async function POST(request: Request) {
  try {
    return Response.json(await estimateAction(await request.json().catch(() => ({}))));
  } catch (error) {
    return errorResponse(error);
  }
}
