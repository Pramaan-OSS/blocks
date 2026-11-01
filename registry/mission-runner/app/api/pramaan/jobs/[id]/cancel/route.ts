import { cancelJob } from "@/lib/pramaan/missions";
import { errorResponse } from "@/lib/pramaan/server";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return Response.json(await cancelJob((await params).id));
  } catch (error) {
    return errorResponse(error);
  }
}
