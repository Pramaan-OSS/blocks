import { connection } from "next/server";
import { getSigning } from "@/lib/pramaan/signing";
import { errorResponse } from "@/lib/pramaan/server";

export async function GET(_request: Request, { params }: { params: Promise<{ ref: string }> }) {
  await connection();
  try {
    return Response.json(await getSigning((await params).ref));
  } catch (error) {
    return errorResponse(error);
  }
}
