import { chatStream } from "@/lib/pramaan/chat";
import { errorResponse } from "@/lib/pramaan/server";

// Streams one reply as server-sent events. Needs a signed-in person; the key stays on the server.
export async function POST(request: Request) {
  try {
    return await chatStream(request, await request.json().catch(() => ({})));
  } catch (error) {
    return errorResponse(error);
  }
}
