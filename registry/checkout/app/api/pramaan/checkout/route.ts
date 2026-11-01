import { connection } from "next/server";
import { createCheckout, getCheckout } from "@/lib/pramaan/checkout";
import { errorResponse } from "@/lib/pramaan/server";

// No sign-in needed: a visitor starts a checkout for a plan you sell. The price is read on the server.
export async function POST(request: Request) {
  try {
    return Response.json(await createCheckout(request, await request.json().catch(() => ({}))));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: Request) {
  await connection();
  try {
    return Response.json(await getCheckout(new URL(request.url).searchParams.get("ref")));
  } catch (error) {
    return errorResponse(error);
  }
}
