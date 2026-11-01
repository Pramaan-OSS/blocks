import { removeOptOut } from "@/lib/pramaan/consent";
import { errorResponse } from "@/lib/pramaan/server";

export async function POST(request: Request) {
  try {
    return Response.json(await removeOptOut(request, await request.json().catch(() => ({}))));
  } catch (error) {
    return errorResponse(error);
  }
}
