import { connection } from "next/server";
import { getAccount } from "@/lib/pramaan/payouts";
import { errorResponse } from "@/lib/pramaan/server";

export async function GET(request: Request) {
  await connection();
  try {
    return Response.json(await getAccount(request));
  } catch (error) {
    return errorResponse(error);
  }
}
