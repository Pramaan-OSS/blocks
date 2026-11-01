"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmAction } from "@/components/pramaan/confirm-action";
import { ErrorState, StatusMessage } from "@/components/pramaan/states";
import { type ApiError, announceChange, api, formatMicro } from "@/lib/pramaan/client";
import type { InviteOutcome } from "@/lib/pramaan/assessment";
import { rememberEmail, usePrice } from "./util";

const selectClass = "pr-select";

type Mode = "link" | "own" | "domain";

const parse = (text: string) => [...new Set(text.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))];

/**
 * Invite one candidate or many. Either create the links only (you send them yourself), or email each
 * candidate their own link from your connected Gmail or Outlook, or from a domain you verified.
 * Invitations never send from a Pramaan address.
 */
export function InvitePanel({ examRef, examTitle, approvalsHref = "/" }: { examRef: string; examTitle: string; approvalsHref?: string }) {
  const [emails, setEmails] = useState("");
  const [mode, setMode] = useState<Mode>("own");
  const [from, setFrom] = useState("");
  const [subject, setSubject] = useState(`Your ${examTitle} test`);
  const [message, setMessage] = useState(`Hello,\n\nYou are invited to take the ${examTitle} test. Use your personal link to start:\n{link}`);
  const [results, setResults] = useState<InviteOutcome[]>();
  const [error, setError] = useState<ApiError>();
  const [status, setStatus] = useState<string>();
  // One key per click on Send: a repeat of the same request never invites twice.
  const key = useRef("");
  useEffect(() => {
    key.current = crypto.randomUUID();
  }, [results]);

  const list = parse(emails);
  const create = usePrice("assessment.invitation.create", { ref: examRef });
  const mail = usePrice("email.send", {});
  const each = create === undefined ? undefined : create + (mode === "link" ? 0 : (mail ?? 0));
  const total = each === undefined ? undefined : each * list.length;
  const delivery = mode === "link" ? { mode: "link" } : { mode: "email", sender: mode === "domain" ? "domain" : "own", from, subject, message };

  async function send() {
    setError(undefined);
    setStatus("Sending…");
    try {
      const done = await api<{ results: InviteOutcome[] }>(`/api/pramaan/assessment/exams/${encodeURIComponent(examRef)}/invitations`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key.current },
        body: JSON.stringify({ emails: list, delivery }),
      });
      done.results.forEach((r) => r.ref && rememberEmail(r.ref, r.email, r.link));
      setResults(done.results);
      const failed = done.results.filter((r) => r.emailed === "failed").length;
      setStatus(failed ? `${done.results.length - failed} invited, ${failed} failed.` : `${done.results.length} invited.`);
      if (!failed) setEmails("");
      announceChange();
    } catch (e) {
      setStatus(undefined);
      setError(e as ApiError);
    }
  }

  return (
    <section aria-label="Invite candidates" className="max-w-xl space-y-4">
      <h3>Invite candidates</h3>
      <div className="space-y-1.5">
        <Label htmlFor="inv-emails">Candidate emails (one per line, up to 50)</Label>
        <Textarea id="inv-emails" rows={4} value={emails} onChange={(e) => setEmails(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="inv-mode">How to deliver</Label>
        <select id="inv-mode" className={selectClass} value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
          <option value="own">Email from my connected Gmail or Outlook</option>
          <option value="domain">Email from a domain I verified</option>
          <option value="link">Only create the links (I will send them)</option>
        </select>
      </div>
      {mode === "domain" && (
        <div className="space-y-1.5">
          <Label htmlFor="inv-from">From address</Label>
          <Input id="inv-from" type="email" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="hiring@your-domain.com" />
        </div>
      )}
      {mode !== "link" && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="inv-subject">Subject</Label>
            <Input id="inv-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inv-message">Message</Label>
            <Textarea id="inv-message" rows={5} value={message} onChange={(e) => setMessage(e.target.value)} />
            <p className="text-xs text-muted-foreground">{"{link}"} becomes each candidate's own link.</p>
          </div>
        </>
      )}
      <ConfirmAction
        label={mode === "link" ? "Create links" : "Send invitations"}
        title={mode === "link" ? "Create these links?" : "Send these invitations?"}
        description={`${list.length} candidate${list.length === 1 ? "" : "s"}. Credit for one test session each is held for ten days; withdrawing an unused invitation releases it. ${total === undefined ? "" : `It costs up to ${formatMicro(total)}.`}`}
        details={
          <div aria-label="Exact details" className="max-h-60 space-y-2 overflow-auto rounded-md bg-muted p-3 text-sm">
            <p>To: {list.join(", ")}</p>
            {mode !== "link" && (
              <>
                <p>From: {mode === "domain" ? from : "your connected Gmail or Outlook"}</p>
                <p>Subject: {subject}</p>
                <pre className="whitespace-pre-wrap font-sans">{message}</pre>
              </>
            )}
          </div>
        }
        confirmLabel={mode === "link" ? "Create links" : "Send"}
        disabled={list.length === 0}
        onConfirm={send}
      />
      <StatusMessage text={status} tone={results?.some((r) => r.emailed === "failed") ? "error" : "success"} />
      {error && <ErrorState error={error} />}
      {results && (
        <ul aria-label="Invitations created" className="pr-rows">
          {results.map((r) => (
            <li key={r.email} className="border-b py-3 text-sm last:border-0">
              <p className="font-semibold">{r.email}</p>
              {r.link && (
                <div className="mt-1 flex items-center gap-2">
                  <Input readOnly aria-label={`Link for ${r.email}`} value={r.link} onFocus={(e) => e.currentTarget.select()} />
                  <Button type="button" variant="outline" size="sm" onClick={() => navigator.clipboard?.writeText(r.link!)}>
                    Copy
                  </Button>
                </div>
              )}
              {r.emailed === "waiting_for_approval" && (
                <p className="mt-1 text-muted-foreground">
                  The email is waiting for a yes. <a className="underline" href={approvalsHref}>Open the approvals inbox</a>.
                </p>
              )}
              {r.emailed === "sent" && <p className="mt-1 text-muted-foreground">Email sent.</p>}
              {r.emailed === "not_requested" && <p className="mt-1 text-muted-foreground">Link created. Send it yourself.</p>}
              {r.emailed === "failed" && r.error && (
                <p role="alert" className="mt-1 text-destructive">
                  {r.error.message} {r.error.next}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
