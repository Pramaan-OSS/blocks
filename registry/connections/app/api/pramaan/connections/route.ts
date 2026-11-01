import { listConnections } from "@/lib/pramaan/connections";
import { connection } from "next/server";
import { errorResponse } from "@/lib/pramaan/server";

export async function GET(request: Request) {
  await connection();
  try {
    return Response.json(await listConnections(request, new URL(request.url).searchParams.get("app") ?? undefined));
  } catch (error) {
    return errorResponse(error);
  }
}
