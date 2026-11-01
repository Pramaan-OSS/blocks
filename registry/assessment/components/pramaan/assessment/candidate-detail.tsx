"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusPill } from "@/components/pramaan/parts";
import { ErrorState, LoadingState } from "@/components/pramaan/states";
import { useResource } from "@/lib/pramaan/client";
import type { Integrity, Invitation, Result, Session } from "@/lib/pramaan/assessment";
import { isNotReady, stateLabel, when } from "./util";

const humanize = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/** A result that isn't there yet is pending with a retry, never an error. */
function Pending({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="status" className="pr-empty flex items-center justify-between gap-3 text-sm">
      <span>
        <strong>Pending.</strong> {message}
      </span>
      <Button size="sm" variant="outline" onClick={onRetry}>
        Check again
      </Button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="space-y-2">
      <h4>{title}</h4>
      {children}
    </section>
  );
}

export function ResultView({ inviteRef }: { inviteRef: string }) {
  const r = useResource<Result>(`/api/pramaan/assessment/invitations/${encodeURIComponent(inviteRef)}/result`);
  if (r.error && !r.data) return isNotReady(r.error) ? <Pending message={r.error.message} onRetry={r.reload} /> : <ErrorState error={r.error} onRetry={r.reload} />;
  if (!r.data) return <LoadingState label="Loading the result" />;
  const d = r.data;
  return (
    <div className="space-y-3 text-sm">
      <p className="flex flex-wrap items-center gap-3">
        <span className="pr-num">{d.score ?? "–"}</span>
        {d.passed === true && <StatusPill tone="green">Passed</StatusPill>}
        {d.passed === false && <StatusPill tone="red">Did not pass</StatusPill>}
        {d.passed === null && <StatusPill>No pass score set</StatusPill>}
        {d.gradingStatus !== "complete" && <StatusPill tone="amber">Grading {d.gradingStatus === "partial" ? "partly done" : "in progress"}</StatusPill>}
        {d.finalizationStatus === "pending_verdict" && <StatusPill tone="amber">Final verdict pending</StatusPill>}
      </p>
      {d.gradingStatus !== "complete" && <Pending message="Some answers are still being graded; the score can change." onRetry={r.reload} />}
      {d.grading && d.grading.length > 0 && (
        <Table aria-label="Grades by question">
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>Question</TableHead>
              <TableHead>Points</TableHead>
              <TableHead>Note</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {d.grading.map((g, i) => (
              <TableRow key={i}>
                <TableCell>{g.order ?? i + 1}</TableCell>
                <TableCell>{g.question}</TableCell>
                <TableCell>
                  {g.pointsAwarded} / {g.pointsPossible}
                </TableCell>
                <TableCell className="text-muted-foreground">{g.rationale ?? (g.isCorrect === true ? "Correct" : g.isCorrect === false ? "Incorrect" : "")}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

export function IntegrityView({ inviteRef }: { inviteRef: string }) {
  const r = useResource<Integrity>(`/api/pramaan/assessment/invitations/${encodeURIComponent(inviteRef)}/integrity`);
  if (r.error && !r.data) return isNotReady(r.error) ? <Pending message={r.error.message} onRetry={r.reload} /> : <ErrorState error={r.error} onRetry={r.reload} />;
  if (!r.data) return <LoadingState label="Loading the integrity report" />;
  const d = r.data;
  return (
    <div className="space-y-3 text-sm">
      <p className="flex flex-wrap items-center gap-3">
        <StatusPill tone={d.verdict === "clean" ? "green" : d.verdict === "flagged" || d.verdict === "terminated" ? "red" : "amber"}>{humanize(d.verdict)}</StatusPill>
        <span>Integrity score {d.integrityScore}</span>
      </p>
      <p>
        Coverage: monitored {d.coverage.heartbeatPct}% of the time; evidence {d.coverage.evidenceComplete ? "complete" : "incomplete"}
        {d.coverage.sufficient === false ? ", not enough to judge" : ""}.
      </p>
      {d.signals.length > 0 ? (
        <Table aria-label="Evidence counts">
          <TableHeader>
            <TableRow>
              <TableHead>Signal</TableHead>
              <TableHead>Severity</TableHead>
              <TableHead>Count</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {d.signals.map((s) => (
              <TableRow key={s.type}>
                <TableCell>{humanize(s.type)}</TableCell>
                <TableCell>{humanize(s.severity)}</TableCell>
                <TableCell>{s.count}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="text-muted-foreground">No integrity signals recorded.</p>
      )}
    </div>
  );
}

/** One candidate: invitation dates, session, then the result and the integrity report once they exist. */
export function CandidateDetail({ inviteRef, name }: { inviteRef: string; name: string }) {
  const inv = useResource<Invitation & { session: Session }>(`/api/pramaan/assessment/invitations/${encodeURIComponent(inviteRef)}`);
  if (inv.error && !inv.data) return <ErrorState error={inv.error} onRetry={inv.reload} />;
  if (!inv.data) return <LoadingState label="Loading the candidate" />;
  const d = inv.data;
  const finished = d.status === "completed";
  return (
    <div className="pr-card space-y-5" aria-label="Candidate details" role="region">
      <h3>{name}</h3>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
        <dt className="text-muted-foreground">State</dt>
        <dd>{stateLabel(d.status, d.emailedAt)}</dd>
        <dt className="text-muted-foreground">Invited</dt>
        <dd>{when(d.createdAt)}</dd>
        <dt className="text-muted-foreground">Emailed</dt>
        <dd>{d.emailedAt ? when(d.emailedAt) : "Not emailed"}</dd>
        <dt className="text-muted-foreground">Started</dt>
        <dd>{d.session.startedAt ? when(d.session.startedAt) : "Not yet"}</dd>
        <dt className="text-muted-foreground">Finished</dt>
        <dd>{d.session.completedAt ? when(d.session.completedAt) : "Not yet"}</dd>
        {d.revokedAt && (
          <>
            <dt className="text-muted-foreground">Withdrawn</dt>
            <dd>{when(d.revokedAt)}</dd>
          </>
        )}
      </dl>
      <Section title="Result">{finished ? <ResultView inviteRef={inviteRef} /> : <p className="text-sm text-muted-foreground">The result shows here once the candidate finishes.</p>}</Section>
      <Section title="Integrity">{finished ? <IntegrityView inviteRef={inviteRef} /> : <p className="text-sm text-muted-foreground">The integrity report shows here once the candidate finishes.</p>}</Section>
    </div>
  );
}
