import { finishUpload } from "@/lib/pramaan/upload";
import { errorResponse } from "@/lib/pramaan/server";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return Response.json(await finishUpload((await params).id));
  } catch (error) {
    return errorResponse(error);
  }
}
