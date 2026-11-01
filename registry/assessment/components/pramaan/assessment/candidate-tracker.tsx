"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmAction } from "@/components/pramaan/confirm-action";
import { StatusPill } from "@/components/pramaan/parts";
import { EmptyState, ErrorState, LoadingState, StatusMessage, type StatusTone } from "@/components/pramaan/states";
import { ApiError, announceChange, api, useResource } from "@/lib/pramaan/client";
import type { Invitation } from "@/lib/pramaan/assessment";
import { candidateName, linkFor, stateLabel, stateTone, when } from "./util";

/** Every invitation of an exam: sent, started, finished, expired. Unused ones can be withdrawn. */
export function CandidateTracker({
  examRef,
  pollMs,
  onSelect,
  selected,
  approvalsHref = "/",
}: {
  examRef: string;
  pollMs?: number;
  onSelect: (ref: string, name: string) => void;
  selected?: string;
  approvalsHref?: string;
}) {
  const list = useResource<{ results: Invitation[] }>(`/api/pramaan/assessment/exams/${encodeURIComponent(examRef)}/invitations`, pollMs);
  const [note, setNote] = useState<{ text: string; tone: StatusTone }>();
  // Names live in this browser only (the list doesn't return them), so read them after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (list.error && !list.data) return <ErrorState error={list.error} onRetry={list.reload} />;
  if (!list.data) return <LoadingState label="Loading candidates" />;
  const rows = list.data.results;
  if (rows.length === 0) return <EmptyState title="No candidates yet">Invite someone to see their progress here.</EmptyState>;

  const counts = new Map<string, number>();
  for (const r of rows) counts.set(stateLabel(r.status, r.emailedAt), (counts.get(stateLabel(r.status, r.emailedAt)) ?? 0) + 1);

  async function withdraw(ref: string) {
    try {
      const res = await api<{ status: string }>(`/api/pramaan/assessment/invitations/${encodeURIComponent(ref)}/revoke`, { method: "POST" });
      setNote(
        res.status === "waiting_for_approval"
          ? { text: "Withdrawal sent for approval. Decide it in the approvals inbox; the credit held for this candidate is released once it is approved.", tone: "info" }
          : { text: "Invitation withdrawn. The credit held for it is released.", tone: "success" },
      );
      announceChange();
    } catch (e) {
      setNote({ text: e instanceof ApiError ? e.message : "Couldn't withdraw. Try again.", tone: "error" });
    }
  }

  return (
    <div className="space-y-3">
      <p className="pr-meta" aria-label="Counts">
        {[...counts].map(([k, n]) => `${k} ${n}`).join(" · ")}
      </p>
      <StatusMessage text={note?.text} tone={note?.tone} />
      {note?.text.includes("approvals inbox") && (
        <a className="text-sm underline" href={approvalsHref}>
          Open the approvals inbox
        </a>
      )}
      <Table aria-label="Candidates">
        <TableHeader>
          <TableRow>
            <TableHead>Candidate</TableHead>
            <TableHead>State</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => {
            const ref = r.ref ?? `row-${i}`;
            // Where this browser doesn't know the email, a number: never the invitation's id.
            const name = mounted ? candidateName(r.ref, i) : `Candidate ${i + 1}`;
            const unused = r.status === "pending" || r.status === "opened";
            const page = mounted ? linkFor(r.ref) : undefined;
            return (
              <TableRow key={ref} data-state={selected === r.ref ? "selected" : undefined}>
                <TableCell>
                  <b className="font-semibold">{name}</b>
                  <span className="pr-row-sub">
                    Invited {when(r.createdAt)} · expires {when(r.expiresAt)}
                  </span>
                </TableCell>
                <TableCell>
                  <StatusPill tone={stateTone(r.status)}>{stateLabel(r.status, r.emailedAt)}</StatusPill>
                </TableCell>
                <TableCell className="space-x-2 text-right">
                  <Button variant="outline" size="sm" aria-label={`Details for ${name}`} onClick={() => r.ref && onSelect(r.ref, name)}>
                    Details
                  </Button>
                  {page && (
                    <Button asChild variant="outline" size="sm">
                      <a href={page} target="_blank" rel="noopener noreferrer" aria-label={`Open the candidate's page for ${name}`}>
                        Open the candidate&apos;s page
                      </a>
                    </Button>
                  )}
                  {unused && r.ref && (
                    <ConfirmAction
                      label="Withdraw"
                      title="Withdraw this invitation?"
                      description="The candidate's link stops working and the credit held for them is released. This needs approval, so the request goes to the approvals inbox first."
                      details={<p aria-label="Exact details" className="rounded-md bg-muted p-3 text-sm">{name}, invited {when(r.createdAt)}</p>}
                      confirmLabel="Withdraw"
                      variant="outline"
                      onConfirm={() => withdraw(r.ref!)}
                    />
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
