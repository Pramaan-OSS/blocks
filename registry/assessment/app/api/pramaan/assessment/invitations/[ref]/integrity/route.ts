import { getIntegrity } from "@/lib/pramaan/assessment";
import { errorResponse } from "@/lib/pramaan/server";

export async function GET(_request: Request, { params }: { params: Promise<{ ref: string }> }) {
  try {
    return Response.json(await getIntegrity((await params).ref));
  } catch (error) {
    return errorResponse(error);
  }
}
