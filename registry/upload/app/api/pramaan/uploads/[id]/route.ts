import { deleteUpload } from "@/lib/pramaan/upload";
import { errorResponse } from "@/lib/pramaan/server";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return Response.json(await deleteUpload((await params).id));
  } catch (error) {
    return errorResponse(error);
  }
}
