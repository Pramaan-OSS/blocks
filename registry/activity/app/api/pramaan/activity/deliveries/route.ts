import { listDeliveries } from "@/lib/pramaan/activity";
import { connection } from "next/server";
import { errorResponse } from "@/lib/pramaan/server";

export async function GET() {
  await connection();
  try {
    return Response.json(await listDeliveries());
  } catch (error) {
    return errorResponse(error);
  }
}
