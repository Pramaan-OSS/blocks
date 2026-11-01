import { checkOptOut } from "@/lib/pramaan/consent";
import { connection } from "next/server";
import { errorResponse } from "@/lib/pramaan/server";

export async function GET(request: Request) {
  await connection();
  try {
    const u = new URL(request.url).searchParams;
    return Response.json(await checkOptOut(request, u.get("address"), u.get("channel")));
  } catch (error) {
    return errorResponse(error);
  }
}
