# Mission runner (`mission-runner`)

Start a mission, watch its steps, see the result and what it cost. Licence: MIT.
A mission is a fixed sequence of steps under one business name (Pramaan calls it an outcome).

## Install

```bash
npx shadcn@4.23.0 add https://raw.githubusercontent.com/Pramaan-OSS/blocks/main/public/r/mission-runner.json
```

It adds the files below, the shadcn `button`, `alert-dialog`, `input`, `label` and `textarea`
components, and the `@pramaan/sdk` and `server-only` packages. Set `PRAMAAN_API_KEY` on the server.

## Look

The block reads the Pramaan theme (`theme.json`: colours, type, pills, rows, buttons). Install it
once and load its fonts (Geist, Fraunces, JetBrains Mono) with `pramaanFonts` on `<html>`; steps are
in the repo README. Without it the block still works in your own shadcn theme.

## Use

```tsx
import { MissionRunner } from "@/components/pramaan/missions/mission-runner";

<MissionRunner missionId="company.research" onResult={(job) => save(job.result)} />
<MissionRunner approvalsHref="/approvals" />   {/* a picker instead of a fixed mission */}
```

| Prop | Default | What it does |
|---|---|---|
| `missionId` | picker | A fixed mission. Leave it out to show a picker of the available ones. |
| `onResult` | | Called once with the finished job (`job.result.result` is the mission's answer). |
| `approvalsHref` | `/` | Where your approvals inbox is, for steps that wait for a yes (block `approvals`). |
| `walletHref` | the API's link | Where your wallet page is (block `wallet`); a refusal for low credit links there. |
| `storageKey` | `missionId` | The browser remembers one run per key, so a reload reattaches to it. |
| `pollMs` | `2000` | How often to check a running job. Stops when it ends. |

`MissionJobView` (props `jobId`, `steps?`, `approvalsHref?`, `onResult?`, `onNewRun?`) shows one run
on its own, if you start runs yourself.

## What it does

- **Start form** built from the mission's input JSON Schema: text, long text, number, yes/no, a
  choice, a list (one per line), JSON for anything nested. Required fields are marked and checked.
- **Estimate first:** the most it can cost, each step with its price, which steps need a person's
  approval, and what is still missing. Start stays off until it can run. A low balance shows the
  API's message and an "Add credit" link.
- **Start** opens a confirm with the exact inputs and the maximum price. It carries one
  `Idempotency-Key` and the estimate's `plan`; a repeat returns the same run.
- **Step timeline:** waiting, running, waiting for approval, done, failed, not run; a live status
  line for screen readers; cost so far.
- **Needs a yes:** a step that asks for approval shows a note linking to the approvals inbox, and
  the run continues by itself after the decision.
- **Cancel:** no new step starts. The confirm says you pay only for the work already done, never
  more than the estimate.
- **Reload:** the run id is kept in `localStorage`; the page reattaches to the same run and never
  starts a second one.
- **Result:** the mission's answer and the final cost; a failed run shows the API's own message.

## Calls it makes

Server only, from `app/api/pramaan/`, with `PRAMAAN_API_KEY`:

| Route in your app | Pramaan call |
|---|---|
| `GET /api/pramaan/missions` | `GET /v1/outcomes` |
| `GET /api/pramaan/missions/{id}` | `GET /v1/outcomes/{id}` |
| `POST /api/pramaan/missions/{id}/estimate` | `POST /v1/outcomes/{id}/estimate` |
| `POST /api/pramaan/missions/{id}/run` | `POST /v1/outcomes/{id}` (`Idempotency-Key`, `Pramaan-Plan`) |
| `GET /api/pramaan/jobs/{id}` | `GET /v1/jobs/{id}` |
| `POST /api/pramaan/jobs/{id}/cancel` | `POST /v1/jobs/{id}/cancel` |

Two things the API doesn't report yet: per-step progress on a running mission, and the
exact shape of a step waiting for approval. Until it does, a running mission shows its steps as
"Running" and the cost so far as unknown; the block uses `progress` when the API sends it.

Try it on the fake with `PRAMAAN_FAKE=1 pnpm dev` and open `/missions`.

## Files

| File | Part |
|---|---|
| `lib/pramaan/missions.ts` | server logic and types |
| `app/api/pramaan/missions/**`, `app/api/pramaan/jobs/**` | route handlers |
| `components/pramaan/missions/mission-runner.tsx` | picker, form, estimate, start |
| `components/pramaan/missions/job-view.tsx` | timeline, cost, cancel, result |
| `components/pramaan/missions/schema-form.tsx` | the form built from a JSON Schema |
| `lib/pramaan/*`, `components/pramaan/*` | shared by every block |
