"use client";

import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/pramaan/parts";

export function StandIn() {
  const finish = (outcome: string) => {
    const ref = new URLSearchParams(window.location.search).get("ref");
    void fetch("/api/demo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "identity", ref, outcome }) });
  };
  return (
    <div className="space-y-4 p-4">
      {/* The provider's screen has no app header, so the stand-in hides ours inside the frame. */}
      <style>{"header.border-b{display:none}"}</style>
      <StatusPill tone="amber">Demo stand-in</StatusPill>
      <p className="text-sm">This stands in for the provider's own check screen. No camera or document is used.</p>
      <div className="flex gap-3">
        <Button onClick={() => finish("approved")}>Pass the check</Button>
        <Button variant="outline" onClick={() => finish("declined")}>Fail the check</Button>
      </div>
    </div>
  );
}
