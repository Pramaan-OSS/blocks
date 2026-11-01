import { describeChoice } from "@/lib/pramaan/picker";
import { errorResponse } from "@/lib/pramaan/server";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return Response.json(await describeChoice(new URL(request.url).searchParams.get("kind") ?? "action", (await params).id));
  } catch (error) {
    return errorResponse(error);
  }
}
