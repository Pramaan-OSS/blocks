import { memberProfile } from "@/lib/pramaan/memory";
import { errorResponse } from "@/lib/pramaan/server";

export async function GET(request: Request) {
  try { return Response.json(await memberProfile(request)); }
  catch (error) { return errorResponse(error); }
}
