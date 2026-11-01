import { getUsage } from "@/lib/pramaan/wallet";
import { connection } from "next/server";
import { errorResponse } from "@/lib/pramaan/server";

export async function GET(request: Request) {
  await connection();
  try {
    return Response.json(await getUsage(Number(new URL(request.url).searchParams.get("days") ?? 30)));
  } catch (error) {
    return errorResponse(error);
  }
}
