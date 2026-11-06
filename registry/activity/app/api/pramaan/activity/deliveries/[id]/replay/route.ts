import { replayDelivery } from "@/lib/pramaan/activity";
import { errorResponse } from "@/lib/pramaan/server";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { return Response.json(await replayDelivery((await params).id)); }
  catch (error) { return errorResponse(error); }
}
