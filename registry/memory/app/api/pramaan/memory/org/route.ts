import { orgQueue } from "@/lib/pramaan/memory";
import { connection } from "next/server";
import { errorResponse } from "@/lib/pramaan/server";

export async function GET(request: Request) {
  await connection();
  try {
    return Response.json(await orgQueue(request));
  } catch (error) {
    return errorResponse(error);
  }
}
