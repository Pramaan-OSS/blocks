import { getMission } from "@/lib/pramaan/missions";
import { errorResponse } from "@/lib/pramaan/server";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return Response.json(await getMission((await params).id));
  } catch (error) {
    return errorResponse(error);
  }
}
