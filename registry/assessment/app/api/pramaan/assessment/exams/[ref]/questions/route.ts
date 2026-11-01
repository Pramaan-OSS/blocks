import { addQuestion } from "@/lib/pramaan/assessment";
import { errorResponse } from "@/lib/pramaan/server";

export async function POST(request: Request, { params }: { params: Promise<{ ref: string }> }) {
  try {
    return Response.json(await addQuestion((await params).ref, await request.json().catch(() => ({}))), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
