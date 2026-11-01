import { decideOrg } from "@/lib/pramaan/memory";
import { errorResponse } from "@/lib/pramaan/server";

export async function POST(request: Request) {
  try {
    return Response.json(await decideOrg(request, await request.json().catch(() => ({}))));
  } catch (error) {
    return errorResponse(error);
  }
}
