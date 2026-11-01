import { listApprovals } from "@/lib/pramaan/approvals";
import { connection } from "next/server";
import { errorResponse } from "@/lib/pramaan/server";

export async function GET(request: Request) {
  await connection();
  try {
    return Response.json(await listApprovals(request));
  } catch (error) {
    return errorResponse(error);
  }
}
