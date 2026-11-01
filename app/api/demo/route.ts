import { resetBookingState } from "@/lib/pramaan/booking";
import { resetPublicLimits } from "@/lib/pramaan/public-guard";
import { addFakeApproval, resetFake, fakeState } from "@/lib/pramaan/fake";
import { finishInvitation } from "@/lib/pramaan/fake-assessment";
import { platform } from "@/lib/pramaan/fake-platform";
import { finishFakeCheckout, finishFakeVerification, setFakeAccount, signFakeSignature, viewFakeSignature } from "@/lib/pramaan/fake-wave3";

// Demo only: drives the fake Pramaan the way the outside world would.
export async function POST(request: Request) {
  if (process.env.PRAMAAN_FAKE !== "1") return new Response(null, { status: 404 });
  const { action, ref, micro, outcome, email } = (await request.json().catch(() => ({}))) as { action?: string; ref?: string; micro?: number; outcome?: string; email?: string };
  // The person finishes the identity screen.
  if (action === "identity" && ref) {
    finishFakeVerification(fakeState(), ref, outcome === "declined" ? "declined" : "approved");
    return Response.json({ ok: true });
  }
  // The seller finishes the provider's setup screen.
  if (action === "payouts") {
    setFakeAccount(fakeState(), { status: "ready" });
    return Response.json({ ok: true });
  }
  // The customer pays, or backs out, on the payment page; they return to the app afterwards.
  if (action === "checkout" && ref) {
    const url = finishFakeCheckout(fakeState(), ref, outcome === "paid" ? "paid" : "cancelled");
    return Response.json({ url: outcome === "paid" ? url : "/checkout" });
  }
  // A signer opens the emailed link, or signs on the signing page.
  if ((action === "esign-open" || action === "esign-sign") && ref && email) {
    const found = (action === "esign-open" ? viewFakeSignature : signFakeSignature)(fakeState(), ref, email);
    return Response.json({ ok: found }, { status: found ? 200 : 404 });
  }
  if (action === "reset") {
    resetFake();
    resetBookingState();
    resetPublicLimits();
  }
  // The candidate finishes the test and grading ends.
  else if (action === "balance" && typeof micro === "number") platform(fakeState()).balanceMicro = micro;
  else if (action === "finish" && ref) finishInvitation(fakeState(), ref, 82);
  else
    addFakeApproval({
      capability: "email.send",
      priceMicro: 2_000,
      input: { to: "sam@example.com", subject: "Welcome aboard", text: "Hi Sam, welcome to the team." },
      requestedBy: { kind: "key", member_id: "mbr_viewer" },
    });
  return Response.json({ ok: true });
}
