import { connection } from "next/server";
import { listUploads, startUpload } from "@/lib/pramaan/upload";
import { errorResponse } from "@/lib/pramaan/server";

// Put your own sign-in check in front of these routes before you ship: they spend storage on your key.
export async function POST(request: Request) {
  try {
    return Response.json(await startUpload(await request.json().catch(() => ({}))));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET() {
  await connection();
  try {
    return Response.json(await listUploads());
  } catch (error) {
    return errorResponse(error);
  }
}
