import { connection } from "next/server";
import { errorResponse } from "@/lib/pramaan/server";
import { getPlans } from "@/lib/pramaan/subscriptions";

export async function GET(request: Request) {
  await connection();
  try {
    return Response.json(await getPlans(request));
  } catch (error) {
    return errorResponse(error);
  }
}
