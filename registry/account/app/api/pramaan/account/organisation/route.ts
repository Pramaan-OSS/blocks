import { setOrganisationName } from "@/lib/pramaan/account";
import { errorResponse } from "@/lib/pramaan/server";

export async function PUT(request: Request) {
  try {
    return Response.json(await setOrganisationName(request, await request.json().catch(() => ({}))));
  } catch (error) {
    return errorResponse(error);
  }
}
