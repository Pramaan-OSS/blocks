import { connection } from "next/server";
import { getVerification, startVerification } from "@/lib/pramaan/identity";
import { errorResponse } from "@/lib/pramaan/server";

export async function POST(request: Request) {
  try {
    return Response.json(await startVerification(request, await request.json().catch(() => ({}))));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: Request) {
  await connection();
  try {
    return Response.json(await getVerification(new URL(request.url).searchParams.get("ref")));
  } catch (error) {
    return errorResponse(error);
  }
}
