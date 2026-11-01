"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function SampleMailbox() {
  const [links, setLinks] = useState<string[]>([]);
  return <section aria-label="Sample mailbox" className="pr-card max-w-xl space-y-3">
    <h2>Sample mailbox</h2>
    <p className="text-sm">Try sam@example.com. No real email is sent. Open the sample reset email below.</p>
    <Button variant="outline" onClick={async () => {
      const response = await fetch("/api/demo/password-reset");
      setLinks((await response.json()).links ?? []);
    }}>Check sample mail</Button>
    {links.map((link, i) => <p key={link}><a className="pr-link" href={link}>Open reset email {i + 1}</a></p>)}
  </section>;
}
