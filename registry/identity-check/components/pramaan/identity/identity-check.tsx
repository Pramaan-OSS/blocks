"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { StatusPill, type PillTone } from "@/components/pramaan/parts";
import { ErrorState, StatusMessage } from "@/components/pramaan/states";
import { ApiError, api, useResource } from "@/lib/pramaan/client";
import type { Result, Started, VerificationState } from "@/lib/pramaan/identity";

const WORDS: Record<VerificationState, { title: string; tone: PillTone; line: string }> = {
  waiting: { title: "Waiting for you", tone: "amber", line: "Follow the steps above to check your identity." },
  in_progress: { title: "In progress", tone: "blue", line: "Your check is being done. This page updates by itself." },
  in_review: { title: "Being reviewed", tone: "blue", line: "A person is looking at your check. This can take a little while." },
  approved: { title: "Verified", tone: "green", line: "Your identity is confirmed." },
  declined: { title: "Not verified", tone: "red", line: "We couldn't confirm your identity. You can try again." },
  expired: { title: "Expired", tone: "grey", line: "This check ran out of time. Start again to get a new one." },
  stopped: { title: "Stopped", tone: "grey", line: "The check was stopped before it finished. You can start again." },
};

const FINAL = new Set<VerificationState>(["approved", "declined", "expired", "stopped"]);

/**
 * Checks a person's identity. Starts the check, shows the provider's own screen in the page (the
 * ID and selfie steps are theirs, not re-skinned), then a plain status card with each check's result.
 */
export function IdentityCheck({ language, pollMs = 4_000 }: { language?: string; pollMs?: number }) {
  const [started, setStarted] = useState<Started>();
  const [note, setNote] = useState<{ text: string; tone: "info" | "error" }>();
  const [settled, setSettled] = useState(false);
  const key = useRef<string>(undefined);
  const r = useResource<Result>(started ? `/api/pramaan/identity?ref=${encodeURIComponent(started.ref)}` : null, settled ? undefined : pollMs);
  useEffect(() => {
    if (r.data && FINAL.has(r.data.state)) setSettled(true);
  }, [r.data]);

  const start = async () => {
    if (note?.tone === "info") return;
    key.current = crypto.randomUUID();
    setNote({ text: "Starting your check…", tone: "info" });
    try {
      const s = await api<Started>("/api/pramaan/identity", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key.current }, body: JSON.stringify({ language }) });
      setSettled(false);
      setStarted(s);
      setNote(undefined);
    } catch (err) {
      setNote({ text: err instanceof ApiError ? err.message : "Something went wrong. Try again.", tone: "error" });
    }
  };

  const w = WORDS[r.data?.state ?? "waiting"];
  return (
    <div className="space-y-4">
      {!started || (settled && r.data?.state !== "approved") ? (
        <div className="space-y-2">
          <Button onClick={start}>{started ? "Try again" : "Check my identity"}</Button>
          <StatusMessage text={note?.text} tone={note?.tone} />
        </div>
      ) : null}
      {started && !settled && (
        <div className="space-y-2">
          <iframe title="Identity check" src={started.url} allow="camera; microphone" className="pr-card h-[520px] w-full" />
          <p className="text-sm">
            Trouble with the camera here? <a className="pr-link" href={started.url} target="_blank" rel="noreferrer">Open the check in a new tab</a>
          </p>
        </div>
      )}
      {started && r.error && !r.data && <ErrorState error={r.error} onRetry={r.reload} />}
      {started && r.data && (
        <section aria-label="Identity check result" className="pr-card space-y-3">
          <StatusPill tone={w.tone}>{w.title}</StatusPill>
          <p role="status" aria-live="polite" className="text-sm">{w.line}</p>
          {r.data.checks.length > 0 && (
            <dl className="pr-fields" aria-label="Checks">
              {r.data.checks.map((c) => (
                <div key={c.label} className="pr-field">
                  <dt>{c.label}</dt>
                  <dd>{c.result}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      )}
    </div>
  );
}
