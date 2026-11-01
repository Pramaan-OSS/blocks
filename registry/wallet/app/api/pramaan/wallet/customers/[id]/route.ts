import { getCustomerCredits } from "@/lib/pramaan/wallet";
import { errorResponse } from "@/lib/pramaan/server";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return Response.json(await getCustomerCredits((await params).id));
  } catch (error) {
    return errorResponse(error);
  }
}
