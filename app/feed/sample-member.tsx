"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
// Demo only: someone else in the community, so there is a person to follow and a message to receive.
export function SampleMember() {
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");
  return <div className="flex flex-wrap items-center gap-3 rounded-md border border-dashed p-3 text-sm">
    <span className="text-muted-foreground">Demo:</span>
    <Button size="sm" variant="outline" onClick={async () => {
      const response = await fetch("/api/demo/community", { method: "POST" });
      setReady(response.ok); setMessage(response.ok ? "Sam posted and sent you a message." : "Sign in to try this.");
    }}>Hear from a sample member</Button>
    {ready && <a className="underline" href="/profiles/mbr_sample">Visit Sam's page</a>}
    <p role="status">{message}</p>
  </div>;
}
