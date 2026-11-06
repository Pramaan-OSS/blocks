import { addOptOut, listOptOuts } from "@/lib/pramaan/consent";
import { connection } from "next/server";
import { errorResponse } from "@/lib/pramaan/server";

export async function GET(request: Request) {
  await connection();
  try {
    const q = new URL(request.url).searchParams;
    return Response.json(await listOptOuts(request, q.get("cursor"), {
      query: q.get("query") || undefined, channel: q.get("channel") || undefined,
      source: q.get("source") || undefined, removed: q.get("removed") === "true",
    }));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    return Response.json(await addOptOut(request, await request.json().catch(() => ({}))));
  } catch (error) {
    return errorResponse(error);
  }
}
