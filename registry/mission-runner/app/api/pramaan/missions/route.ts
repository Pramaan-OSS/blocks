import { listMissions } from "@/lib/pramaan/missions";
import { connection } from "next/server";
import { errorResponse } from "@/lib/pramaan/server";

export async function GET() {
  await connection();
  try {
    return Response.json(await listMissions());
  } catch (error) {
    return errorResponse(error);
  }
}
