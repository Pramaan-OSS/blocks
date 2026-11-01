import { createExam, listExams } from "@/lib/pramaan/assessment";
import { connection } from "next/server";
import { errorResponse } from "@/lib/pramaan/server";

export async function GET() {
  await connection();
  try {
    return Response.json(await listExams());
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    return Response.json(await createExam(await request.json().catch(() => ({}))), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
