import { getCall } from "@/lib/pramaan/activity";
import { errorResponse } from "@/lib/pramaan/server";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return Response.json(await getCall((await params).id));
  } catch (error) {
    return errorResponse(error);
  }
}
