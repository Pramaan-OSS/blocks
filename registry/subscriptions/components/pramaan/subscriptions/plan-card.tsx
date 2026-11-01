"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { StatusPill, type PillTone } from "@/components/pramaan/parts";
import { EmptyState, ErrorState, LoadingState, StatusMessage } from "@/components/pramaan/states";
import { ApiError, api, useResource } from "@/lib/pramaan/client";
import { formatDate } from "@/lib/pramaan/plain";
import type { Plan, PlanStatus } from "@/lib/pramaan/subscriptions";

// The signed-in customer's plan, and a button to the hosted billing page, where they change their
// card or cancel. Nothing here sends a customer id: the server knows who is signed in.

const STATUS: Record<PlanStatus, { label: string; tone: PillTone }> = {
  active: { label: "Active", tone: "green" },
  trialing: { label: "Free trial", tone: "blue" },
  past_due: { label: "Payment overdue", tone: "red" },
  paused: { label: "Paused", tone: "grey" },
  canceled: { label: "Cancelled", tone: "grey" },
  expired: { label: "Ended", tone: "grey" },
  pending: { label: "Starting", tone: "amber" },
  failed: { label: "Didn't start", tone: "red" },
  unknown: { label: "Checking", tone: "grey" },
};

function price(p: Plan): string | undefined {
  if (p.amount === undefined || !p.currency) return undefined;
  let money: string;
  try {
    money = new Intl.NumberFormat("en", { style: "currency", currency: p.currency.toUpperCase() }).format(p.amount);
  } catch {
    money = `${p.amount} ${p.currency.toUpperCase()}`;
  }
  if (!p.interval) return money;
  const n = p.intervalCount ?? 1;
  return n === 1 ? `${money} a ${p.interval}` : `${money} every ${n} ${p.interval}s`;
}

function line(p: Plan): string | undefined {
  if (p.endsAt) return `Ends on ${formatDate(p.endsAt, { time: false })}. You won't be charged again.`;
  if (p.status === "past_due") return "Your last payment didn't go through. Update your payment method.";
  if (p.status === "trialing" && p.nextBillingAt) return `Free until ${formatDate(p.nextBillingAt, { time: false })}, then the first charge.`;
  if (p.status === "active" && p.nextBillingAt) return `Renews on ${formatDate(p.nextBillingAt, { time: false })}.`;
  if (p.status === "paused") return "Your plan is paused, so you aren't being charged.";
  return undefined;
}

/** `emptyHref` is where someone with no plan can pick one. `onRedirect` opens the billing page. */
export function PlanCard({ emptyHref = "/checkout", onRedirect = (url) => window.location.assign(url) }: { emptyHref?: string; onRedirect?: (url: string) => void }) {
  const r = useResource<{ plans: Plan[] }>("/api/pramaan/subscriptions");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  if (r.loading) return <LoadingState label="Loading your plan" />;
  if (r.error || !r.data) return <ErrorState error={r.error ?? new ApiError("Something went wrong. Try again.", "internal")} onRetry={r.reload} />;
  if (r.data.plans.length === 0)
    return (
      <EmptyState title="No plan yet">
        <a className="pr-link" href={emptyHref}>See the plans</a>
      </EmptyState>
    );
  return (
    <div className="space-y-4">
      <ul aria-label="Your plans" className="space-y-3">
        {r.data.plans.map((p, i) => (
          <li key={i} className="pr-card space-y-1">
            <div className="flex items-center justify-between gap-3">
              <b>{price(p) ?? "Your plan"}</b>
              <StatusPill tone={p.endsAt ? "amber" : STATUS[p.status].tone}>{p.endsAt ? "Ending" : STATUS[p.status].label}</StatusPill>
            </div>
            <p className="text-sm text-muted-foreground">{line(p)}</p>
          </li>
        ))}
      </ul>
      <div className="space-y-2">
        <Button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(undefined);
            try {
              const res = await api<{ url: string }>("/api/pramaan/subscriptions/portal", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
              onRedirect(res.url);
            } catch (e) {
              setError(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
              setBusy(false);
            }
          }}
        >
          Manage billing
        </Button>
        <StatusMessage text={busy && !error ? "Taking you to the billing page…" : error} tone={error ? "error" : "info"} />
        <p className="text-sm text-muted-foreground">There you can change your card, see invoices or cancel.</p>
      </div>
    </div>
  );
}
