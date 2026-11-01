import { estimateMission } from "@/lib/pramaan/missions";
import { errorResponse } from "@/lib/pramaan/server";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return Response.json(await estimateMission((await params).id, await request.json().catch(() => ({}))));
  } catch (error) {
    return errorResponse(error);
  }
}
