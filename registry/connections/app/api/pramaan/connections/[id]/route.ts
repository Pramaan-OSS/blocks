import { checkConnection } from "@/lib/pramaan/connections";
import { errorResponse } from "@/lib/pramaan/server";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return Response.json(await checkConnection(request, (await params).id));
  } catch (error) {
    return errorResponse(error);
  }
}
