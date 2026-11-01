import { decideApproval } from "@/lib/pramaan/approvals";
import { errorResponse } from "@/lib/pramaan/server";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return Response.json(await decideApproval(request, (await params).id));
  } catch (error) {
    return errorResponse(error);
  }
}
