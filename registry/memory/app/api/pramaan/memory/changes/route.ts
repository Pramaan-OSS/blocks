import { listChanges } from "@/lib/pramaan/memory";
import { connection } from "next/server";
import { errorResponse } from "@/lib/pramaan/server";

export async function GET(request: Request) {
  await connection();
  try {
    return Response.json(await listChanges(request, new URL(request.url).searchParams.get("cursor")));
  } catch (error) {
    return errorResponse(error);
  }
}
