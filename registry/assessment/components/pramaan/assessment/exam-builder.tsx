"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmAction } from "@/components/pramaan/confirm-action";
import { StatusPill } from "@/components/pramaan/parts";
import { EmptyState, ErrorState, StatusMessage, type StatusTone } from "@/components/pramaan/states";
import { ApiError, announceChange, api, formatMicro } from "@/lib/pramaan/client";
import type { Question } from "@/lib/pramaan/assessment";
import { usePrice } from "./util";

const post = <T,>(url: string, body?: unknown) =>
  api<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

const selectClass = "pr-select";

/** Step 1: a new draft exam. `onCreated` gets its ref. */
export function ExamForm({ onCreated }: { onCreated: (ref: string) => void }) {
  const [v, setV] = useState({ title: "", description: "", durationMinutes: "30", passScore: "", proctoring: true, profile: "record", identityRequired: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError>();
  const set = (patch: Partial<typeof v>) => setV({ ...v, ...patch });
  return (
    <form
      className="max-w-xl space-y-4"
      aria-label="New exam"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(undefined);
        try {
          const created = await post<{ ref?: string }>("/api/pramaan/assessment/exams", {
            title: v.title,
            description: v.description,
            durationMinutes: Number(v.durationMinutes),
            passScore: v.passScore,
            proctoring: { enabled: v.proctoring, profile: v.profile },
            identityRequired: v.identityRequired,
          });
          announceChange();
          if (created.ref) onCreated(created.ref);
        } catch (err) {
          setError(err as ApiError);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="exam-title">Title *</Label>
        <Input id="exam-title" value={v.title} onChange={(e) => set({ title: e.target.value })} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="exam-desc">Description</Label>
        <Textarea id="exam-desc" rows={2} value={v.description} onChange={(e) => set({ description: e.target.value })} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="exam-min">Length (minutes) *</Label>
          <Input id="exam-min" type="number" min={1} value={v.durationMinutes} onChange={(e) => set({ durationMinutes: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="exam-pass">Pass score (0 to 100)</Label>
          <Input id="exam-pass" type="number" min={0} max={100} value={v.passScore} onChange={(e) => set({ passScore: e.target.value })} />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input id="exam-proctor" type="checkbox" className="size-4 accent-primary" checked={v.proctoring} onChange={(e) => set({ proctoring: e.target.checked })} />
        <Label htmlFor="exam-proctor">Proctor the test</Label>
      </div>
      {v.proctoring && (
        <div className="space-y-1.5">
          <Label htmlFor="exam-profile">Proctoring level</Label>
          <select id="exam-profile" className={selectClass} value={v.profile} onChange={(e) => set({ profile: e.target.value })}>
            <option value="observe">Camera on</option>
            <option value="record">Recording</option>
            <option value="verify">Verify</option>
            <option value="secure">Secure</option>
          </select>
        </div>
      )}
      <div className="flex items-center gap-2">
        <input id="exam-id" type="checkbox" className="size-4 accent-primary" checked={v.identityRequired} onChange={(e) => set({ identityRequired: e.target.checked })} />
        <Label htmlFor="exam-id">Check the candidate's identity first</Label>
      </div>
      {error && <ErrorState error={error} />}
      <Button type="submit" disabled={busy}>
        {busy ? "Creating…" : "Create draft"}
      </Button>
    </form>
  );
}

/** Questions in the order candidates see them. `reveal` shows which options are correct (the author's view). */
export function QuestionList({ questions, reveal = true }: { questions: readonly Question[]; reveal?: boolean }) {
  if (questions.length === 0) return <EmptyState title="No questions yet">Add the first question below.</EmptyState>;
  return (
    <ol aria-label={reveal ? "Questions" : "Candidate preview"} className="pr-rows">
      {questions.map((q) => (
        <li key={q.order} className="border-b py-3 text-sm last:border-0">
          <p className="font-semibold">
            {q.order}. {q.text} {q.points !== undefined && <span className="font-normal text-muted-foreground">({q.points} pts)</span>}
          </p>
          {q.content.options && (
            <ul className="mt-2 space-y-1">
              {q.content.options.map((o, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span aria-hidden>{q.content.allowMultiple ? "☐" : "○"}</span>
                  {o.text}
                  {reveal && o.isCorrect && <StatusPill tone="green">Correct</StatusPill>}
                </li>
              ))}
            </ul>
          )}
          {q.type === "text" && (
            <>
              <Textarea disabled rows={2} aria-label={`Answer to question ${q.order}`} className="mt-2" placeholder={q.content.maxWords ? `Up to ${q.content.maxWords} words` : ""} />
              {reveal && q.content.rubric && <p className="mt-1 text-xs text-muted-foreground">Grading guide: {q.content.rubric}</p>}
            </>
          )}
        </li>
      ))}
    </ol>
  );
}

/** Adds a multiple-choice or written-answer question to a draft exam. */
export function QuestionForm({ examRef, onAdded }: { examRef: string; onAdded: () => void }) {
  const blank = { type: "mcq", text: "", points: "5", maxWords: "200", rubric: "", options: ["", "", "", ""], correct: [false, false, false, false] };
  const [v, setV] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError>();
  return (
    <form
      aria-label="Add a question"
      className="pr-card max-w-xl space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(undefined);
        try {
          await post(`/api/pramaan/assessment/exams/${encodeURIComponent(examRef)}/questions`, {
            type: v.type,
            text: v.text,
            points: v.points,
            options: v.options.map((text, i) => ({ text, isCorrect: v.correct[i] })),
            maxWords: v.maxWords,
            rubric: v.rubric,
          });
          setV(blank);
        } catch (err) {
          setError(err as ApiError);
        } finally {
          // A lost answer may still have saved the question: always read the list again before a retry.
          setBusy(false);
          onAdded();
        }
      }}
    >
      <h3>Add a question</h3>
      <div className="space-y-1.5">
        <Label htmlFor="q-type">Type</Label>
        <select id="q-type" className={selectClass} value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })}>
          <option value="mcq">Multiple choice</option>
          <option value="text">Written answer</option>
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="q-text">Question *</Label>
        <Textarea id="q-text" rows={2} value={v.text} onChange={(e) => setV({ ...v, text: e.target.value })} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="q-points">Points</Label>
        <Input id="q-points" type="number" min={0} value={v.points} onChange={(e) => setV({ ...v, points: e.target.value })} />
      </div>
      {v.type === "mcq" ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Options (tick the correct ones)</legend>
          {v.options.map((text, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                aria-label={`Option ${i + 1} is correct`}
                checked={v.correct[i]}
                onChange={(e) => setV({ ...v, correct: v.correct.map((c, j) => (j === i ? e.target.checked : c)) })}
              />
              <Input aria-label={`Option ${i + 1}`} value={text} onChange={(e) => setV({ ...v, options: v.options.map((o, j) => (j === i ? e.target.value : o)) })} />
            </div>
          ))}
        </fieldset>
      ) : (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="q-words">Max words</Label>
            <Input id="q-words" type="number" min={1} value={v.maxWords} onChange={(e) => setV({ ...v, maxWords: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="q-rubric">Grading guide</Label>
            <Textarea id="q-rubric" rows={2} value={v.rubric} onChange={(e) => setV({ ...v, rubric: e.target.value })} />
          </div>
        </>
      )}
      {error && <ErrorState error={error} />}
      <Button type="submit" disabled={busy}>
        {busy ? "Adding…" : "Add question"}
      </Button>
    </form>
  );
}

/** Publishing freezes the questions and can't be undone, so it asks first and shows the price. */
export function PublishExam({ examRef, title, questionCount, durationMinutes, onPublished }: { examRef: string; title: string; questionCount: number; durationMinutes: number; onPublished: () => void }) {
  const price = usePrice("assessment.exam.publish", { ref: examRef });
  const [note, setNote] = useState<{ text: string; tone: StatusTone }>();
  return (
    <div className="space-y-2">
      <ConfirmAction
        label="Publish exam"
        title="Publish this exam?"
        description={`Publishing freezes the questions and cannot be undone. ${price === undefined ? "" : `It costs up to ${formatMicro(price)}.`}`}
        details={
          <dl aria-label="Exact details" className="rounded-md bg-muted p-3 text-sm">
            <div>Title: {title}</div>
            <div>Questions: {questionCount}</div>
            <div>Length: {durationMinutes} minutes</div>
          </dl>
        }
        confirmLabel="Publish"
        disabled={questionCount === 0}
        onConfirm={async () => {
          try {
            await post(`/api/pramaan/assessment/exams/${encodeURIComponent(examRef)}/publish`);
            announceChange();
            onPublished();
          } catch (e) {
            setNote({ text: e instanceof ApiError ? e.message : "Couldn't publish. Try again.", tone: "error" });
          }
        }}
      />
      {questionCount === 0 && <p className="text-sm text-muted-foreground">Add at least one question to publish.</p>}
      <StatusMessage text={note?.text} tone={note?.tone} />
    </div>
  );
}
