import "server-only";
import { PramaanError } from "@pramaan/sdk";
import { billingCustomerFor } from "@/lib/pramaan/subscriptions-customer";
import { capability, signedOut } from "@/lib/pramaan/server";

// Server half of the subscriptions block: the signed-in customer's plans, a link to the hosted
// billing page, and a helper to record metered usage. Calls billing.subscriptions.list,
// billing.portal.create and billing.usage.record. The customer comes from your own sign-in
// (subscriptions-customer.ts), never from the browser.

export type PlanStatus = "active" | "trialing" | "past_due" | "paused" | "canceled" | "expired" | "pending" | "failed" | "unknown";

export interface Plan {
  readonly status: PlanStatus;
  /** The recurring charge in major units (29 is $29.00), when the API says. */
  readonly amount?: number;
  readonly currency?: string;
  readonly interval?: "day" | "week" | "month" | "year";
  readonly intervalCount?: number;
  /** The next charge. */
  readonly nextBillingAt?: string;
  /** Set when the plan stops at the end of the paid period. */
  readonly endsAt?: string;
}

interface Row {
  readonly status: PlanStatus;
  readonly recurringAmount?: { amount: number; currency: string };
  readonly interval?: Plan["interval"];
  readonly intervalCount?: number;
  readonly cancelAtPeriodEnd?: boolean;
  readonly currentPeriodEnd?: string;
  readonly nextBillingAt?: string;
  readonly canceledAt?: string;
}

const bad = (message: string) => new PramaanError("invalid_request", message, { status: 400 });

async function customerOf(request: Request): Promise<string> {
  const id = await billingCustomerFor(request);
  if (!id) throw signedOut("Your plan shows here once you're signed in.");
  return id;
}

/** The signed-in customer's plans, newest information first. No ids leave the server. */
export async function getPlans(request: Request): Promise<{ plans: Plan[] }> {
  const customerId = await customerOf(request);
  const res = await capability<{ results: Row[] }>("billing.subscriptions.list", { customerId });
  const plans = res.results.map((r): Plan => ({
    status: r.status,
    ...(r.recurringAmount ? { amount: r.recurringAmount.amount, currency: r.recurringAmount.currency } : {}),
    ...(r.interval ? { interval: r.interval, intervalCount: r.intervalCount ?? 1 } : {}),
    ...(r.nextBillingAt ? { nextBillingAt: r.nextBillingAt } : {}),
    ...(r.cancelAtPeriodEnd && r.currentPeriodEnd ? { endsAt: r.currentPeriodEnd } : {}),
  }));
  return { plans };
}

/** The app's own address, for the page the customer returns to. Set APP_URL behind a proxy. */
const appUrl = (request: Request) => (process.env.APP_URL || new URL(request.url).origin).replace(/\/$/, "");

/**
 * A short-lived link to the hosted billing page, where the customer changes their card or cancels.
 * `returnPath` is where they come back to: a path on this app, never a full address.
 */
export async function openPortal(request: Request, body: { returnPath?: unknown }): Promise<{ url: string }> {
  const customerId = await customerOf(request);
  const path = body.returnPath === undefined ? "/subscriptions" : body.returnPath;
  if (typeof path !== "string" || !/^\/(?!\/)[\w\-./]*$/.test(path)) throw bad("Choose a page on this site to come back to.");
  const res = await capability<{ portalUrl: string }>("billing.portal.create", { customerId, returnUrl: `${appUrl(request)}${path}` });
  let url: URL;
  try {
    url = new URL(res.portalUrl);
  } catch {
    throw new PramaanError("internal", "The billing page couldn't be opened. Try again.", { status: 502 });
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new PramaanError("internal", "The billing page couldn't be opened. Try again.", { status: 502 });
  return { url: url.toString() };
}

/**
 * Records one billable usage event for a customer, from your own server code (not a route: a
 * visitor must never be able to record their own usage). `key` makes a retry count once.
 */
export async function recordUsage(customerId: string, event: string, properties?: Record<string, string | number | boolean>, key?: string): Promise<{ duplicate: boolean }> {
  if (!customerId.trim() || !event.trim()) throw bad("Say which customer and which event to record.");
  const res = await capability<{ recorded: true; duplicate: boolean }>("billing.usage.record", { customerId, event, ...(properties ? { properties } : {}) }, key ? { "Idempotency-Key": key } : undefined);
  return { duplicate: res.duplicate };
}
