import { publishExam } from "@/lib/pramaan/assessment";
import { errorResponse } from "@/lib/pramaan/server";

export async function POST(_request: Request, { params }: { params: Promise<{ ref: string }> }) {
  try {
    return Response.json(await publishExam((await params).ref));
  } catch (error) {
    return errorResponse(error);
  }
}
