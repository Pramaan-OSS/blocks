import { addOptOut, listOptOuts } from "@/lib/pramaan/consent";
import { connection } from "next/server";
import { errorResponse } from "@/lib/pramaan/server";

export async function GET(request: Request) {
  await connection();
  try {
    return Response.json(await listOptOuts(request, new URL(request.url).searchParams.get("cursor")));
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
