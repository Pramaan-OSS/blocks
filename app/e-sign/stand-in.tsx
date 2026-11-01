"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusPill } from "@/components/pramaan/parts";
import { StatusMessage } from "@/components/pramaan/states";
import { ApiError, announceChange, api, useResource } from "@/lib/pramaan/client";
import type { SigningRow } from "@/lib/pramaan/signing";

// Demo only: stands in for the signing page a signer opens from their email. Shown when PRAMAAN_FAKE=1.
export function SignerStandIn() {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<string>();
  const list = useResource<{ results: SigningRow[] }>("/api/pramaan/signing");
  const latest = list.data?.results[0];
  const act = async (action: "esign-open" | "esign-sign") => {
    try {
      await api("/api/demo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ref: latest?.ref, email }) });
      setMsg(undefined);
      announceChange();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "Something went wrong.");
    }
  };
  return (
    <section aria-label="Signing page" className="pr-card space-y-3">
      <h2>Signing page <StatusPill tone="amber">Demo stand-in</StatusPill></h2>
      <p className="text-sm">This stands in for the page a signer opens from their email. Nothing is signed for real. It acts on the newest agreement above.</p>
      <div className="space-y-1">
        <Label htmlFor="stand-in-email">Signer's email</Label>
        <Input id="stand-in-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="flex gap-3">
        <Button variant="outline" disabled={!latest || !email} onClick={() => act("esign-open")}>Open the email link</Button>
        <Button disabled={!latest || !email} onClick={() => act("esign-sign")}>Sign</Button>
      </div>
      <StatusMessage text={msg} tone="error" />
    </section>
  );
}
