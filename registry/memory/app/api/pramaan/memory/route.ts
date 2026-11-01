import { listMemories } from "@/lib/pramaan/memory";
import { connection } from "next/server";
import { errorResponse } from "@/lib/pramaan/server";

export async function GET(request: Request) {
  await connection();
  try {
    const u = new URL(request.url);
    // Whose memories is decided on the server from the signed-in person; a `user` parameter is ignored.
    return Response.json(await listMemories(request, u.searchParams.get("q"), u.searchParams.get("cursor")));
  } catch (error) {
    return errorResponse(error);
  }
}
