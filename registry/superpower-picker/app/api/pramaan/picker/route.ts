import { searchChoices } from "@/lib/pramaan/picker";
import { connection } from "next/server";
import { errorResponse } from "@/lib/pramaan/server";

export async function GET(request: Request) {
  await connection();
  try {
    return Response.json(await searchChoices(new URL(request.url).searchParams.get("q")));
  } catch (error) {
    return errorResponse(error);
  }
}
