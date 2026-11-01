import { connection } from "next/server";
import { closeSession, endCall, lines, openSession, placeCall, readEvents } from "@/lib/pramaan/voice";
import { errorResponse } from "@/lib/pramaan/server";

// GET reads a session's call events (or, with no session, the lines to call from). POST does one thing: { action: "open" | "call" | "end" | "close" }.
export async function GET(request: Request) {
  await connection();
  try {
    const q = new URL(request.url).searchParams;
    return Response.json(q.get("ref") ? await readEvents(request, q.get("ref"), q.get("cursor")) : await lines(request));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const result =
      body.action === "open" ? await openSession(request, body)
      : body.action === "call" ? await placeCall(request, body)
      : body.action === "end" ? await endCall(request, body)
      : body.action === "close" ? await closeSession(request, body)
      : undefined;
    if (!result) return Response.json({ error: { code: "invalid_request", message: "Choose what to do with the phone." } }, { status: 400 });
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
