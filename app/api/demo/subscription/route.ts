import { fakeState } from "@/lib/pramaan/fake";
import { cancelFakeSubscription } from "@/lib/pramaan/fake-wave3";

// Demo only: the customer cancels on the billing page, which the outside world would record.
export async function POST(request: Request) {
  if (process.env.PRAMAAN_FAKE !== "1") return new Response(null, { status: 404 });
  const { customer } = (await request.json().catch(() => ({}))) as { customer?: string };
  return Response.json({ ok: typeof customer === "string" && cancelFakeSubscription(fakeState(), customer) });
}
