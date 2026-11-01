import { remindSigner } from "@/lib/pramaan/signing";
import { errorResponse } from "@/lib/pramaan/server";

export async function POST(request: Request, { params }: { params: Promise<{ ref: string }> }) {
  try {
    const { email } = (await request.json().catch(() => ({}))) as { email?: unknown };
    return Response.json(await remindSigner((await params).ref, email));
  } catch (error) {
    return errorResponse(error);
  }
}
