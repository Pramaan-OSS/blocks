"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PageTitle, StatusPill } from "@/components/pramaan/parts";
import { StatusMessage } from "@/components/pramaan/states";

export function StandIn() {
  const [note, setNote] = useState<string>();
  const params = () => new URLSearchParams(window.location.search);
  return (
    <div className="space-y-6">
      <PageTitle title="Billing page">
        <StatusPill tone="amber">Demo stand-in</StatusPill> This stands in for the secure billing page. Nothing is charged.
      </PageTitle>
      <div className="flex gap-3">
        <Button
          variant="outline"
          onClick={async () => {
            await fetch("/api/demo/subscription", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customer: params().get("customer") }) });
            setNote("Your plan will end when the paid period does.");
          }}
        >
          Cancel at the end of the period
        </Button>
        <Button
          onClick={() => {
            // Only a path on this site: never follow a full address from the query.
            let path = "/subscriptions";
            try {
              const back = new URL(params().get("return") ?? "");
              if (back.origin === window.location.origin) path = back.pathname;
            } catch {}
            window.location.assign(path);
          }}
        >
          Back to the app
        </Button>
      </div>
      <StatusMessage text={note} tone="success" />
    </div>
  );
}
