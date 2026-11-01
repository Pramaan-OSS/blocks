"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { StatusPill, type PillTone } from "@/components/pramaan/parts";
import { ErrorState, LoadingState, StatusMessage } from "@/components/pramaan/states";
import { ApiError, api, useResource } from "@/lib/pramaan/client";
import type { CheckoutState, Started } from "@/lib/pramaan/checkout";

const KEY = "pramaan-checkout-ref";

/**
 * Sends the customer to the hosted payment page for one plan. `plan` is a key in
 * `lib/pramaan/checkout-plans.ts`; the price is read on the server. One click makes one checkout
 * even if it is clicked twice.
 */
export function CheckoutButton({ plan, label = "Pay now", email, onRedirect = (url) => window.location.assign(url) }: { plan: string; label?: string; email?: string; onRedirect?: (url: string) => void }) {
  const [state, setState] = useState<{ text?: string; busy: boolean }>({ busy: false });
  const key = useRef<string>(undefined);
  return (
    <div className="space-y-2">
      <Button
        disabled={state.busy}
        onClick={async () => {
          // One key per click, so a double click can't make two payment pages.
          key.current = crypto.randomUUID();
          setState({ busy: true, text: "Taking you to the payment page…" });
          try {
            const r = await api<Started>("/api/pramaan/checkout", {
              method: "POST",
              headers: { "Content-Type": "application/json", "Idempotency-Key": key.current },
              body: JSON.stringify({ plan, email }),
            });
            sessionStorage.setItem(KEY, r.ref);
            onRedirect(r.checkoutUrl);
          } catch (err) {
            setState({ busy: false, text: err instanceof ApiError ? err.message : "Something went wrong. Try again." });
          }
        }}
      >
        {label}
      </Button>
      <StatusMessage text={state.text} tone={state.busy ? "info" : "error"} />
    </div>
  );
}

const WORDS: Record<CheckoutState, { title: string; tone: PillTone; line: string }> = {
  waiting: { title: "Waiting for payment", tone: "amber", line: "We haven't received the payment yet. This page updates by itself." },
  paid: { title: "Paid", tone: "green", line: "Thank you. The payment went through." },
  cancelled: { title: "Cancelled", tone: "grey", line: "The payment was cancelled and you were not charged." },
  expired: { title: "Expired", tone: "grey", line: "This payment page ran out of time. Start again to get a new one." },
  declined: { title: "Payment declined", tone: "red", line: "The payment didn't go through. Try another way to pay." },
  unknown: { title: "Checking", tone: "grey", line: "We can't tell yet whether the payment went through. Check again in a moment." },
};

const FINAL = new Set<CheckoutState>(["paid", "cancelled", "expired", "declined"]);

/** Whether the last checkout was paid. Reads the payment from this browser, and updates until it settles. */
export function CheckoutStatus({ pollMs = 3_000, backHref = "/checkout" }: { pollMs?: number; backHref?: string }) {
  const [ref, setRef] = useState<string | null | undefined>(undefined);
  const [settled, setSettled] = useState(false);
  useEffect(() => setRef(sessionStorage.getItem(KEY)), []);
  const r = useResource<{ state: CheckoutState }>(ref ? `/api/pramaan/checkout?ref=${encodeURIComponent(ref)}` : null, settled ? undefined : pollMs);
  useEffect(() => {
    if (r.data && FINAL.has(r.data.state)) setSettled(true);
  }, [r.data]);
  if (ref === undefined || (ref && !r.data && !r.error)) return <LoadingState label="Checking your payment" />;
  if (!ref) return <p className="pr-card text-sm">There's no payment to show in this browser. <a className="pr-link" href={backHref}>Start a checkout</a></p>;
  if (r.error && !r.data) return <ErrorState error={r.error} onRetry={r.reload} />;
  const w = WORDS[r.data?.state ?? "unknown"];
  return (
    <section aria-label="Payment" className="pr-card space-y-2">
      <StatusPill tone={w.tone}>{w.title}</StatusPill>
      <p role="status" aria-live="polite" className="text-sm">{w.line}</p>
      {r.data?.state !== "paid" && settled && <a className="pr-link" href={backHref}>Back to the checkout</a>}
    </section>
  );
}
