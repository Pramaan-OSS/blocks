import { deleteConnection } from "@/lib/pramaan/connections";
import { errorResponse } from "@/lib/pramaan/server";

export async function POST(request: Request) {
  try {
    return Response.json(await deleteConnection(request, await request.json().catch(() => ({}))));
  } catch (error) {
    return errorResponse(error);
  }
}
