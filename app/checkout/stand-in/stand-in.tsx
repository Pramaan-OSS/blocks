"use client";

import { Button } from "@/components/ui/button";
import { PageTitle, StatusPill } from "@/components/pramaan/parts";

export function StandIn() {
  const finish = async (outcome: "paid" | "cancelled") => {
    const ref = new URLSearchParams(window.location.search).get("ref");
    const res = await fetch("/api/demo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "checkout", ref, outcome }) });
    window.location.assign(((await res.json()) as { url: string }).url);
  };
  return (
    <div className="space-y-6">
      <PageTitle title="Payment page">
        <StatusPill tone="amber">Demo stand-in</StatusPill> This stands in for the secure payment page. No card is asked for and no money moves.
      </PageTitle>
      <div className="flex gap-3">
        <Button onClick={() => finish("paid")}>Pay</Button>
        <Button variant="outline" onClick={() => finish("cancelled")}>Cancel</Button>
      </div>
    </div>
  );
}
