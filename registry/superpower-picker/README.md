# Superpower picker (`superpower-picker`)

Find an action or a mission in plain words, see what it costs, and run it. Licence: MIT.

## Install

```bash
npx shadcn@4.23.0 add https://raw.githubusercontent.com/Pramaan-OSS/blocks/main/public/r/superpower-picker.json
```

It adds the files below, the shadcn `button`, `alert-dialog`, `input`, `label`, `textarea` and `badge`
components, and the `@pramaan/sdk` and `server-only` packages. Set `PRAMAAN_API_KEY` on the server.

## Look

The block reads the Pramaan theme (`theme.json`). Install it once and load its fonts with
`pramaanFonts` on `<html>`; steps are in the repo README.

## Use

```tsx
import { SuperpowerPicker } from "@/components/pramaan/picker/superpower-picker";

<SuperpowerPicker approvalsHref="/approvals" missionsHref="/missions" walletHref="/wallet?topup=1" />
```

| Prop | Default | What it does |
|---|---|---|
| `approvalsHref` | `/` | Where your approvals inbox lives. Actions that send wait there. |
| `missionsHref` | `/missions` | Where your mission runner lives; a mission's "Run it in Missions" link goes there. |
| `walletHref` | the API's own link | Where a low-credit refusal sends people. |

## What it shows

- **A search box** ("What do you want to do?"). When the words fit several actions about equally,
  the API's one clarifying question shows with a button for each answer.
- **Matches** by plain name ("Send a text message"), what each does, its kind (single action or
  mission) and the most it can cost. Nothing that can't run now is offered. With no words it lists
  the first 20; searching narrows them.
- **Details:** the price, whether it needs a yes or a connected account, and a form built from the
  action's inputs (required fields are marked and checked before any call).
- **Get the price** first, then **Run it** behind a confirm that shows the exact inputs and the
  maximum price. A double click never runs it twice (one idempotency key per price).
- **Actions that send something** (an email, a text) say so, and "Ask for a yes" sends the request to
  the approvals inbox. It runs once, after the decision.
- **Results** show as labelled lines, never raw JSON.
- **Missions** show their steps and open in the mission runner; the picker doesn't run them itself.

## Calls it makes

Server only, from `app/api/pramaan/picker/`, with `PRAMAAN_API_KEY`:

| Route in your app | Pramaan call |
|---|---|
| `GET /api/pramaan/picker?q=` | `GET /v1/capabilities?query=` and `GET /v1/outcomes` |
| `GET /api/pramaan/picker/{id}?kind=` | `GET /v1/capabilities/{id}` or `GET /v1/outcomes/{id}` |
| `POST /api/pramaan/picker/{id}/estimate` | `POST /v1/capabilities/{id}/estimate` |
| `POST /api/pramaan/picker/{id}/run` | `POST /v1/capabilities/{id}` with an `Idempotency-Key` |

Try it on the fake with `PRAMAAN_FAKE=1 pnpm dev` and open `/picker`.

## Files

| File | Part |
|---|---|
| `lib/pramaan/picker.ts` | server logic and types |
| `app/api/pramaan/picker/**` | route handlers |
| `components/pramaan/picker/superpower-picker.tsx` | the screen |
| `components/pramaan/schema-form.tsx` | the form builder, shared with the mission runner |
| `lib/pramaan/*`, `components/pramaan/*` | shared by every block |
