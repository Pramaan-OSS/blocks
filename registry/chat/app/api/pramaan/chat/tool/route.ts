import { connection } from "next/server";
import { runTool, toolJob } from "@/lib/pramaan/chat";
import { errorResponse } from "@/lib/pramaan/server";

// Runs a tool the assistant asked for. Only tools listed in lib/pramaan/chat-tools.ts can run.
export async function POST(request: Request) {
  try {
    return Response.json(await runTool(request, await request.json().catch(() => ({})), request.headers.get("idempotency-key")));
  } catch (error) {
    return errorResponse(error);
  }
}

// How a tool run that waited for a yes ended: ?job=
export async function GET(request: Request) {
  await connection();
  try {
    return Response.json(await toolJob(request, new URL(request.url).searchParams.get("job")));
  } catch (error) {
    return errorResponse(error);
  }
}
