# Assessment (`assessment`)

The builder-side screens for proctored tests. Licence: MIT.

The hosted test engine owns the exam, the test page, grading, the identity check and the integrity
report. This block is only what you, the builder, see: exams, questions, invitations, results.
The candidate takes the test on the hosted page their link opens; there is no test-taking screen
here.

## Install

```bash
npx shadcn@4.23.0 add https://raw.githubusercontent.com/Pramaan-OSS/blocks/main/public/r/assessment.json
```

It adds the files below, the shadcn `button`, `badge`, `tabs`, `alert-dialog`, `input`, `label`,
`textarea` and `table` components, and the `@pramaan/sdk` and `server-only` packages. Set
`PRAMAAN_API_KEY` on the server. To email invitations, connect Gmail or Outlook (block
`connections`) or verify a sending domain.

## Look

The block reads the Pramaan theme (`theme.json`: colours, type, pills, rows, buttons). Install it
once and load its fonts (Geist, Fraunces, JetBrains Mono) with `pramaanFonts` on `<html>`; steps are
in the repo README. Without it the block still works in your own shadcn theme.

## Use

```tsx
import { AssessmentHub } from "@/components/pramaan/assessment/assessment-hub";

<AssessmentHub approvalsHref="/approvals" pollMs={15000} />
```

| Prop | Default | What it does |
|---|---|---|
| `approvalsHref` | `/` | Where your approvals inbox is (block `approvals`). Emails and withdrawals wait there. |
| `pollMs` | off | Re-check the candidate list this often. |

The parts are exported too: `ExamForm`, `QuestionForm`, `QuestionList`, `PublishExam`
(`exam-builder.tsx`), `InvitePanel`, `CandidateTracker`, `CandidateDetail`, `ResultView`,
`IntegrityView`.

## Screens

| Screen | What it does |
|---|---|
| Exam list | Your exams, draft or published, with question count and length |
| Exam builder | A draft form (title, length, pass score, proctoring, identity check), multiple-choice and written-answer questions, a preview as a candidate sees it, and Publish |
| Invite | One or many emails; either email each their own link (from your connected Gmail or Outlook, or a domain you verified) or only create the links |
| Candidate tracker | Link created, sent, started, finished, expired, revoked, with counts; Withdraw for unused ones; "Open the candidate's page" shows what the candidate sees (using the returned invitation link, with browser memory only when the link is missing) |
| Result | Score, pass or fail, grading progress, grade and note for each question |
| Integrity | Verdict, score, how much of the test was monitored, evidence counts |

## Rules it keeps

- **Publish** asks first, says it can't be undone, and shows the most it costs. It freezes the questions.
- **Invite** asks first with the exact list, the message and the most it costs. Credit for one
  session per candidate is held for ten days. The click carries one key, so a repeat never invites
  twice.
- **Withdraw** (revoke) asks first and goes to the approvals inbox; the held credit is released once
  it is approved. A candidate who already started can't be withdrawn.
- **Invitation emails never send from a Pramaan address.** The server refuses one before any call.
- **"Not ready yet"** results and integrity reports show as pending with "Check again", not as an error.
- An email sent with a key waits for a yes in the approvals inbox too; the invite list says so.

## Calls it makes

Server only, from `app/api/pramaan/assessment/`, with `PRAMAAN_API_KEY`. Each is `POST
/v1/capabilities/{id}`:

| Route in your app | Superpowers |
|---|---|
| `GET, POST exams` | `assessment.exams.list`, `assessment.exam.create` |
| `GET exams/{ref}` | `assessment.exam.get`, `assessment.questions.list` |
| `POST exams/{ref}/questions` | `assessment.question.create` |
| `POST exams/{ref}/publish` | `assessment.exam.publish` |
| `GET, POST exams/{ref}/invitations` | `assessment.invitations.list`; `assessment.invitation.create` and `email.send` |
| `GET invitations/{ref}` | `assessment.invitation.get`, `assessment.session.get` |
| `POST invitations/{ref}/revoke` | `assessment.invitation.revoke` |
| `GET invitations/{ref}/result` | `assessment.result.get` |
| `GET invitations/{ref}/integrity` | `assessment.integrity-report.get` |
| `POST estimate` | `POST /v1/capabilities/{id}/estimate`, for the price in a confirm |

The missions `assessment.exam.build`, `assessment.invite.send` and `assessment.invites.clean-up`
run in the mission runner block: `<MissionRunner missionId="assessment.exam.build" />`.

Not in this version: reordering or deleting questions (the API can't), saving invitation
emails as drafts, and question types beyond multiple choice and written answer.

Try it on the fake with `PRAMAAN_FAKE=1 pnpm dev` and open `/assessment`.

## Files

| File | Part |
|---|---|
| `lib/pramaan/assessment.ts` | server logic and types |
| `app/api/pramaan/assessment/**` | route handlers |
| `components/pramaan/assessment/*` | hub, builder, invite, tracker, detail |
| `lib/pramaan/*`, `components/pramaan/*` | shared by every block |
