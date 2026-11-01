import { deleteMemory } from "@/lib/pramaan/memory";
import { errorResponse } from "@/lib/pramaan/server";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return Response.json(await deleteMemory(request, (await params).id));
  } catch (error) {
    return errorResponse(error);
  }
}
