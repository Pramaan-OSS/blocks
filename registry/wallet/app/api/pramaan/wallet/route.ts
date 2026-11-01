import { getWallet } from "@/lib/pramaan/wallet";
import { connection } from "next/server";
import { errorResponse } from "@/lib/pramaan/server";

export async function GET() {
  await connection();
  try {
    return Response.json(await getWallet());
  } catch (error) {
    return errorResponse(error);
  }
}
