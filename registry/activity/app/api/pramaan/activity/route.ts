import { listActivity } from "@/lib/pramaan/activity";
import { connection } from "next/server";
import { errorResponse } from "@/lib/pramaan/server";

export async function GET(request: Request) {
  await connection();
  try {
    const q = new URL(request.url).searchParams;
    return Response.json(await listActivity({ capability: q.get("capability"), status: q.get("status"), from: q.get("from"), to: q.get("to"), cursor: q.get("cursor") }));
  } catch (error) {
    return errorResponse(error);
  }
}
