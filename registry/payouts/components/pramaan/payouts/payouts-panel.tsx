"use client";

import { lazy, Suspense, useState } from "react";
import { Button } from "@/components/ui/button";
import { StatusPill, type PillTone } from "@/components/pramaan/parts";
import { ErrorState, LoadingState, StatusMessage } from "@/components/pramaan/states";
import { ApiError, announceChange, api, useResource } from "@/lib/pramaan/client";
import type { Account, AccountState, SetupSession } from "@/lib/pramaan/payouts";

// Loaded only for a real session: it pulls in the provider's own script.
const ProviderSetup = lazy(() => import("./provider-setup"));

const WORDS: Record<AccountState, { title: string; tone: PillTone; line: string }> = {
  ready: { title: "Ready", tone: "green", line: "You can take payments and receive payouts." },
  pending: { title: "Setting up", tone: "amber", line: "Finish setting up to take payments and receive payouts." },
  restricted: { title: "Blocked", tone: "red", line: "Payments are paused until the details below are given." },
};

const session = (view: "setup" | "manage") => api<SetupSession>("/api/pramaan/payouts/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ view }) });

/** The seller's payment account: where it stands, what is still needed, and the provider's own setup screen. */
export function PayoutsPanel() {
  const r = useResource<Account>("/api/pramaan/payouts");
  const [open, setOpen] = useState<{ view: "setup" | "manage"; s: Extract<SetupSession, { mode: "embedded" }> }>();
  const [note, setNote] = useState<{ text: string; tone: "info" | "error" }>();
  if (r.loading && !r.data) return <LoadingState label="Loading your payment account" />;
  if (r.error || !r.data) return r.error ? <ErrorState error={r.error} onRetry={r.reload} /> : null;
  const a = r.data;
  const w = WORDS[a.state];
  const start = async (view: "setup" | "manage") => {
    setNote({ text: "Opening…", tone: "info" });
    try {
      const s = await session(view);
      if (s.mode === "hosted") return window.location.assign(s.url);
      setNote(undefined);
      setOpen({ view, s });
    } catch (err) {
      setNote({ text: err instanceof ApiError ? err.message : "Something went wrong. Try again.", tone: "error" });
    }
  };
  const close = () => {
    setOpen(undefined);
    announceChange();
  };
  return (
    <div className="space-y-4">
      <section aria-label="Payment account" className="pr-card space-y-3">
        <div className="flex items-center gap-3">
          <h2>Payment account</h2>
          <StatusPill tone={w.tone}>{w.title}</StatusPill>
        </div>
        <p className="text-sm">{w.line}</p>
        <dl className="pr-fields" aria-label="What works">
          <div className="pr-field"><dt>Take payments</dt><dd>{a.canTakePayments ? "Yes" : "Not yet"}</dd></div>
          <div className="pr-field"><dt>Receive payouts</dt><dd>{a.canReceivePayouts ? "Yes" : "Not yet"}</dd></div>
        </dl>
        {a.due.length > 0 && (
          <div className="space-y-2 pt-2">
            <h3>Still needed</h3>
            <ul className="list-disc pl-5 text-sm">{a.due.map((d) => <li key={d}>{d}</li>)}</ul>
          </div>
        )}
        {a.canManage ? (
          !open && <Button onClick={() => start(a.state === "ready" ? "manage" : "setup")}>{a.state === "ready" ? "Manage payouts" : a.state === "restricted" ? "Give the missing details" : "Set up payments"}</Button>
        ) : (
          <p className="text-sm text-muted-foreground">Only an owner or admin can change payment settings.</p>
        )}
        <StatusMessage text={note?.text} tone={note?.tone} />
      </section>
      {open && (
        <section aria-label="Payment setup" className="space-y-3">
          {open.s.standIn ? (
            <div className="pr-card space-y-3" data-stand-in>
              <StatusPill tone="amber">Demo stand-in</StatusPill>
              <p className="text-sm">This stands in for the provider's own setup screen. Nothing is sent to a real account.</p>
              <div className="flex gap-3">
                <Button
                  onClick={async () => {
                    await fetch("/api/demo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "payouts" }) });
                    close();
                  }}
                >
                  Finish setup
                </Button>
                <Button variant="outline" onClick={close}>Close</Button>
              </div>
            </div>
          ) : (
            <Suspense fallback={<LoadingState label="Loading the setup screen" />}>
              <ProviderSetup session={open.s} view={open.view} refresh={async () => (await session(open.view)) as Extract<SetupSession, { mode: "embedded" }>} onExit={close} />
              <Button variant="outline" onClick={close}>Close</Button>
            </Suspense>
          )}
        </section>
      )}
    </div>
  );
}
