import { forgetEverything } from "@/lib/pramaan/memory";
import { errorResponse } from "@/lib/pramaan/server";

export async function POST(request: Request) {
  try {
    return Response.json(await forgetEverything(request));
  } catch (error) {
    return errorResponse(error);
  }
}
