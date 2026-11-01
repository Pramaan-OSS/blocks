import { getApproval } from "@/lib/pramaan/approvals";
import { errorResponse } from "@/lib/pramaan/server";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return Response.json(await getApproval(request, (await params).id));
  } catch (error) {
    return errorResponse(error);
  }
}
