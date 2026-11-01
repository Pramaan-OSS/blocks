import { connection } from "next/server";
import { listSignings, sendForSignature } from "@/lib/pramaan/signing";
import { errorResponse } from "@/lib/pramaan/server";

// Sending is a real, outward action: put your own sign-in check in front of it before you ship.
export async function POST(request: Request) {
  try {
    return Response.json(await sendForSignature(request, await request.json().catch(() => ({}))));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET() {
  await connection();
  try {
    return Response.json(await listSignings());
  } catch (error) {
    return errorResponse(error);
  }
}
