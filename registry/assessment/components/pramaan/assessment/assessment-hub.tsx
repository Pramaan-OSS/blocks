"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusPill } from "@/components/pramaan/parts";
import { EmptyState, ErrorState, LoadingState, StatusMessage } from "@/components/pramaan/states";
import { useResource } from "@/lib/pramaan/client";
import type { ExamRow, ExamSettings, Question } from "@/lib/pramaan/assessment";
import { CandidateDetail } from "./candidate-detail";
import { CandidateTracker } from "./candidate-tracker";
import { ExamForm, PublishExam, QuestionForm, QuestionList } from "./exam-builder";
import { InvitePanel } from "./invite-panel";
import { examStatus, watchLabel } from "./util";

type ExamFull = ExamSettings & { ref: string; questions: Question[] };

function ExamPanel({ examRef, approvalsHref, pollMs }: { examRef: string; approvalsHref?: string; pollMs?: number }) {
  const exam = useResource<ExamFull>(`/api/pramaan/assessment/exams/${encodeURIComponent(examRef)}`);
  const [candidate, setCandidate] = useState<{ ref: string; name: string }>();
  const [preview, setPreview] = useState(false);
  // Kept here, not in the publish button: the button goes away once the exam is published.
  const [notice, setNotice] = useState<string>();
  if (exam.error && !exam.data) return <ErrorState error={exam.error} onRetry={exam.reload} />;
  if (!exam.data) return <LoadingState label="Loading the exam" />;
  const e = exam.data;
  const draft = e.status === "draft";
  const status = examStatus(e.status);
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="flex items-center gap-3">
          {e.title} <StatusPill tone={status.tone}>{status.label}</StatusPill>
        </h2>
        <p className="text-sm text-muted-foreground">
          {e.durationMinutes} minutes · {e.questions.length} question{e.questions.length === 1 ? "" : "s"}
          {e.passScore !== undefined && ` · pass at ${e.passScore}`}
          {watchLabel(e.proctoring) && ` · ${watchLabel(e.proctoring)}`}
          {e.identityRequired && " · identity check"}
        </p>
      </div>
      <StatusMessage text={notice} tone="success" />
      <Tabs defaultValue="questions">
        <TabsList>
          <TabsTrigger value="questions">Questions</TabsTrigger>
          <TabsTrigger value="candidates">Candidates</TabsTrigger>
        </TabsList>
        <TabsContent value="questions" className="space-y-4">
          <div className="flex gap-2">
            <Button variant="outline" size="sm" aria-pressed={preview} onClick={() => setPreview(!preview)}>
              {preview ? "Back to the author view" : "Preview as a candidate"}
            </Button>
          </div>
          <QuestionList questions={e.questions} reveal={!preview} />
          {draft ? (
            <>
              <QuestionForm examRef={examRef} onAdded={exam.reload} />
              <PublishExam examRef={examRef} title={e.title} questionCount={e.questions.length} durationMinutes={e.durationMinutes} onPublished={() => { setNotice("Published. The questions are now frozen."); exam.reload(); }} />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Published exams are frozen: the questions can't change.</p>
          )}
        </TabsContent>
        <TabsContent value="candidates" className="space-y-6">
          {draft ? (
            <EmptyState title="Publish the exam first">Candidates can be invited once the exam is published.</EmptyState>
          ) : (
            <>
              <InvitePanel examRef={examRef} examTitle={e.title} approvalsHref={approvalsHref} />
              <CandidateTracker examRef={examRef} pollMs={pollMs} selected={candidate?.ref} onSelect={(ref, name) => setCandidate({ ref, name })} approvalsHref={approvalsHref} />
              {candidate && <CandidateDetail key={candidate.ref} inviteRef={candidate.ref} name={candidate.name} />}
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * The builder-side screens for proctored tests: your exams, a builder for questions, publishing,
 * inviting candidates, a tracker, results and integrity reports. The candidate takes the test on the
 * hosted page their link opens; there is no test-taking screen here.
 *
 * `approvalsHref`: where your approvals inbox is. `pollMs`: re-check the candidate list this often.
 */
export function AssessmentHub({ approvalsHref, pollMs }: { approvalsHref?: string; pollMs?: number }) {
  const list = useResource<{ results: ExamRow[] }>("/api/pramaan/assessment/exams");
  const [selected, setSelected] = useState<string>();
  const [creating, setCreating] = useState(false);

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,2.4fr)]">
      <nav aria-label="Exams" className="space-y-3">
        <Button className="w-full" onClick={() => { setCreating(true); setSelected(undefined); }}>
          New exam
        </Button>
        {list.error && !list.data ? (
          <ErrorState error={list.error} onRetry={list.reload} />
        ) : !list.data ? (
          <LoadingState label="Loading exams" />
        ) : list.data.results.length === 0 ? (
          <EmptyState title="No exams yet">Create the first one.</EmptyState>
        ) : (
          <ul className="pr-rows">
            {list.data.results.map((x) => {
              const s = examStatus(x.status);
              return (
                <li key={x.ref ?? x.title}>
                  <button type="button" aria-pressed={selected === x.ref} onClick={() => { setSelected(x.ref); setCreating(false); }} className="pr-row">
                    <span className="pr-row-main">
                      <b>{x.title}</b>
                      <span className="pr-row-sub">
                        {x.questionCount} question{x.questionCount === 1 ? "" : "s"} · {x.durationMinutes} min
                      </span>
                    </span>
                    <span className="pr-row-side">
                      <StatusPill tone={s.tone}>{s.label}</StatusPill>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </nav>
      <section aria-label="Exam">
        {creating ? (
          <ExamForm onCreated={(ref) => { setCreating(false); setSelected(ref); list.reload(); }} />
        ) : selected ? (
          <ExamPanel key={selected} examRef={selected} approvalsHref={approvalsHref} pollMs={pollMs} />
        ) : (
          <EmptyState title="Choose an exam">Or create a new one.</EmptyState>
        )}
      </section>
    </div>
  );
}
