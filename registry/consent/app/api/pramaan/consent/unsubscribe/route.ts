import { clientIp, limitPublic, PUBLIC_WRITE_LIMIT, PUBLIC_WINDOW_MS } from "@/lib/pramaan/public-guard";
import { unsubscribe } from "@/lib/pramaan/consent";
import { errorResponse } from "@/lib/pramaan/server";

// Public: no sign-in; bound attempts before contacting the service.
export async function POST(request: Request) {
  try {
    limitPublic("consent-stop", clientIp(request), PUBLIC_WRITE_LIMIT, PUBLIC_WINDOW_MS);
    return Response.json(await unsubscribe(await request.json().catch(() => ({}))));
  } catch (error) {
    return errorResponse(error);
  }
}
