import "server-only";
import { PramaanError } from "@pramaan/sdk";
import { PLANS } from "@/lib/pramaan/checkout-plans";
import { capability } from "@/lib/pramaan/server";

// Server half of the checkout block: makes a hosted payment page for one plan and reads whether it
// was paid. Calls payments.checkout.create and payments.checkout.get. The customer enters their
// card on the hosted page only; this app never sees it.

export type CheckoutState = "waiting" | "paid" | "cancelled" | "expired" | "declined" | "unknown";

export interface Started {
  readonly checkoutUrl: string;
  /** An opaque handle for reading the result later. Keep it in the browser; never show it. */
  readonly ref: string;
}

const bad = (message: string) => new PramaanError("invalid_request", message, { status: 400 });
const REF = /^ref_[A-Za-z0-9_-]{3,120}$/;

/** The app's own address, for the pages the customer returns to. Set APP_URL behind a proxy. */
const appUrl = (request: Request) => (process.env.APP_URL || new URL(request.url).origin).replace(/\/$/, "");

export async function createCheckout(request: Request, body: { plan?: unknown; quantity?: unknown; email?: unknown }): Promise<Started> {
  const plan = typeof body.plan === "string" ? PLANS[body.plan] : undefined;
  if (!plan) throw bad("That plan isn't available. Choose one from the list.");
  const quantity = body.quantity === undefined ? 1 : Number(body.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) throw bad("Choose a quantity from 1 to 100.");
  const email = typeof body.email === "string" && body.email.trim() !== "" ? body.email.trim() : undefined;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad("That email address doesn't look right.");
  const base = appUrl(request);
  const key = request.headers.get("idempotency-key") ?? undefined;
  const res = await capability<{ ref: string; checkoutUrl: string }>(
    "payments.checkout.create",
    {
      lineItems: [{ name: plan.name, amount: plan.amountCents, currency: plan.currency, quantity, ...(plan.interval ? { interval: plan.interval } : {}) }],
      mode: plan.interval ? "subscription" : "payment",
      successUrl: `${base}/checkout/done`,
      cancelUrl: `${base}/checkout`,
      ...(email ? { customerEmail: email } : {}),
    },
    key ? { "Idempotency-Key": key } : undefined,
  );
  return { checkoutUrl: res.checkoutUrl, ref: res.ref };
}

const STATE: Record<string, CheckoutState> = {
  active: "waiting", unpaid: "waiting", pending: "waiting", paid: "paid", completed: "paid",
  cancelled: "cancelled", expired: "expired", refused: "declined",
};

/** Whether the checkout was paid. Anything unclear reads as unknown, never as paid. */
export async function getCheckout(ref: string | null): Promise<{ state: CheckoutState }> {
  if (!ref || !REF.test(ref)) throw bad("That payment couldn't be found. Start again from the checkout.");
  const res = await capability<{ status: string; payments: { status: string }[] }>("payments.checkout.get", { ref });
  const state = STATE[res.status] ?? "unknown";
  // "completed" alone is not proof of money: paid needs a captured payment.
  return { state: state === "paid" && !res.payments.some((p) => p.status === "captured") ? "waiting" : state };
}
