import { connection } from "next/server";
import { availability, book, bookingHost, bookingSetting } from "@/lib/pramaan/booking";
import { clientIp, limitPublic, PUBLIC_READ_LIMIT, PUBLIC_WINDOW_MS, PUBLIC_WRITE_LIMIT } from "@/lib/pramaan/public-guard";
import { errorResponse } from "@/lib/pramaan/server";

// No sign-in needed: a visitor sees the open times and books one on the owner's calendar.
export async function GET(request: Request) {
  await connection();
  try {
    bookingHost();
    limitPublic("booking-get", clientIp(request), bookingSetting("PRAMAAN_BOOKING_GET_LIMIT", PUBLIC_READ_LIMIT), PUBLIC_WINDOW_MS);
    const q = new URL(request.url).searchParams;
    return Response.json(await availability(request, { from: q.get("from"), days: q.get("days") }));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    bookingHost();
    limitPublic("booking-post", clientIp(request), bookingSetting("PRAMAAN_BOOKING_IP_LIMIT", PUBLIC_WRITE_LIMIT), PUBLIC_WINDOW_MS);
    const body: unknown = await request.json().catch(() => ({}));
    return Response.json(await book(request, body && typeof body === "object" ? body : {}));
  } catch (error) {
    return errorResponse(error);
  }
}
