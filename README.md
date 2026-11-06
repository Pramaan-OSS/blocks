# Pramaan blocks

A **block** is one feature, such as an approval inbox or a wallet, that you copy into your own
Next.js (App Router) app. A **kit** is a whole product (our templates). Blocks are copied in with
the shadcn CLI, not installed as packages: the files become yours to read and change.

Every block has two halves:

- a **server half**: route handlers in `app/api/pramaan/<block>/` that call Pramaan with
  `PRAMAAN_API_KEY`. The key never reaches the browser;
- a **client half**: React components built from shadcn components and Tailwind.

## Install

Each block is one shadcn command. Run it in a Next.js (App Router) app that has shadcn set up
(`npx shadcn@4.23.0 init`):

```bash
npx shadcn@4.23.0 add https://raw.githubusercontent.com/Pramaan-OSS/blocks/main/public/r/<name>.json
```

For example, the approval inbox:

```bash
npx shadcn@4.23.0 add https://raw.githubusercontent.com/Pramaan-OSS/blocks/main/public/r/approvals.json
```

Each block also brings the shared `pramaan-core` files (server helper, session hook, fake Pramaan,
shared components). They come in automatically, so there is nothing extra to add. `theme` is a
separate install: see [Theme](#theme).

Then set two environment variables (see `.env.example`):

- `PRAMAAN_API_KEY`: your Pramaan key, on the server only. Never give it a `NEXT_PUBLIC_` prefix.
- `PRAMAAN_FAKE=1`: use the built-in fake Pramaan to try a block with no key. No calls leave the app.

Last, make `lib/pramaan/session.ts` return the signed-in person's Pramaan `member_id`.

To run the demo from this repo:

```bash
pnpm install
pnpm dev
```

Then open http://localhost:3100. `pnpm dev` runs the demo on the fake Pramaan, so no key is needed.

## Blocks

| Block | What it does | Docs |
|---|---|---|
| `approvals` | Approval inbox: pending list, exact inputs, Approve / Decline, history, nav badge | [registry/approvals/README.md](registry/approvals/README.md) |
| `mission-runner` | Start a mission from a schema-built form, estimate, live steps, cancel, result and cost | [registry/mission-runner/README.md](registry/mission-runner/README.md) |
| `assessment` | Proctored tests: exam builder, invitations, candidate tracker, results, integrity | [registry/assessment/README.md](registry/assessment/README.md) |
| `wallet` | Balance, top-up, usage by day and by what it was spent on, latest activity | [registry/wallet/README.md](registry/wallet/README.md) |
| `connections` | Connected apps: connect, return, check, reconnect, disconnect | [registry/connections/README.md](registry/connections/README.md) |
| `memory` | What the assistant remembers: your memories, recent changes, organisation review | [registry/memory/README.md](registry/memory/README.md) |
| `superpower-picker` | Find an action in plain words, see the price, run it from a form | [registry/superpower-picker/README.md](registry/superpower-picker/README.md) |
| `consent` | Opt-out list, check a contact, badge, public unsubscribe page | [registry/consent/README.md](registry/consent/README.md) |
| `activity` | What ran, what it cost, what failed and what to do next | [registry/activity/README.md](registry/activity/README.md) |
| `chat` | A chat with an assistant; replies stream, actions that need a yes wait in the approvals inbox | [registry/chat/README.md](registry/chat/README.md) |
| `account` | Who is signed in, the organisation name, the team for owners and admins | [registry/account/README.md](registry/account/README.md) |
| `contacts` | People and companies with search, notes, history and company links in your app's database | [registry/contacts/README.md](registry/contacts/README.md) |
| `pipeline` | Deals and tasks with stage moves, owners, values and totals in your app's database | [registry/pipeline/README.md](registry/pipeline/README.md) |
| `subscriptions` | A customer's plan and a button to the hosted billing page | [registry/subscriptions/README.md](registry/subscriptions/README.md) |
| `voice-call` | A phone in the browser: open, call, hang up, mute, call log | [registry/voice-call/README.md](registry/voice-call/README.md) |
| `booking` | Visitors book an open time on your own connected calendar | [registry/booking/README.md](registry/booking/README.md) |
| `e-sign` | Send a document to be signed by email, see who has signed, remind, open the signed copy | [registry/e-sign/README.md](registry/e-sign/README.md) |
| `upload` | Drag and drop files, progress straight to storage, list, open and delete | [registry/upload/README.md](registry/upload/README.md) |
| `checkout` | Take a payment on a hosted payment page | [registry/checkout/README.md](registry/checkout/README.md) |
| `payouts` | Let a seller set up their own payment account and see where it stands | [registry/payouts/README.md](registry/payouts/README.md) |
| `identity-check` | Check a person's identity with an ID document and a selfie | [registry/identity-check/README.md](registry/identity-check/README.md) |

## Theme

Blocks use only the standard shadcn colour, radius and font variables, so they pick up your
app's theme. `theme.css` is the Pramaan look: colour, type, radius, the component looks (buttons,
pills, cards, tables, fields, tabs, rows) and dark mode (the `dark` class on `<html>`). Install it
with `npx shadcn@4.23.0 add https://raw.githubusercontent.com/Pramaan-OSS/blocks/main/public/r/theme.json`. That adds `app/pramaan-theme.css` and
`lib/pramaan/fonts.ts`. Then:

1. Import the CSS after Tailwind: `@import "./pramaan-theme.css";` in `app/globals.css`. Delete
   the `:root` and `.dark` colour blocks (and the `@theme inline` block) that `shadcn init` wrote
   there: the theme sets every one of those variables, and a later copy would override it.
2. Put the fonts on `<html>`: `<html lang="en" className={pramaanFonts}>`, with
   `import { pramaanFonts } from "@/lib/pramaan/fonts"`. They are Geist (interface), Fraunces
   (headings) and JetBrains Mono (code facts), loaded with `next/font/google`.

To restyle, edit the variables at the top of that one CSS file. Fonts that fail to load fall back
to system fonts.

## This repo

| Path | What |
|---|---|
| `registry/pramaan-core/` | Shared files every block ships: server helper, session hook, fake Pramaan, browser helpers, states, confirm |
| `registry/<block>/` | One block's own files |
| `registry.json` | The registry; `pnpm registry:build` writes `public/r/*.json` |
| `app/` | The demo app. Its API routes re-export the block route files from `registry/` |
| `tests/`, `e2e/` | Unit tests on the fake, and a headless Playwright walk of the demo |

```bash
pnpm install
pnpm dev             # demo on http://localhost:3100, with the fake Pramaan
pnpm test            # unit tests (fake, no network)
pnpm e2e             # headless Playwright walk of the demo
pnpm registry:build  # rebuild public/r after changing a block
```

### Adding a block

Name a block's component files differently from its server file in `lib/pramaan/` (`wallet-panel.tsx`, not `wallet.tsx`): the shadcn CLI rewrites imports by file name, and a clash points the import at the wrong file on install.

1. Put its files in `registry/<name>/`, with the same paths they get in an app.
2. Reuse the shared files: `pramaan()` and `errorResponse()` from `lib/pramaan/server.ts`,
   `useResource()` and `api()` from `lib/pramaan/client.ts`, the states in
   `components/pramaan/states.tsx`, and `ConfirmAction` for anything that sends, pays or deletes.
   Add the routes it needs to `lib/pramaan/fake.ts`.
3. Add its entry to `registry.json`, listing the `pramaan-core` files too. Shared files are
   copied into every block, so a second install skips them when nothing changed.
4. Add a path alias in `tsconfig.json`, a demo page, tests and a README.

## Licence

MIT (see `LICENSE`). Every block is MIT too.

Password recovery: see [password-reset](registry/password-reset/README.md) for reset links, signed-in password changes and private email delivery. The demo is at `/password-reset`.

Profiles and community safety: [profiles](registry/profiles/README.md) adds a public page with
private-by-default fields and photo uploads; [moderation](registry/moderation/README.md)
adds reporting, blocking and an owner/admin review queue. Demo pages: `/profiles` and
`/moderation`. Both use app-owned Postgres with numbered migrations and the shared fake.

Listings and applications: [listings](registry/listings/README.md) adds posting, public search with
filters and paging, and moderation; [applications](registry/applications/README.md) adds applying,
status moves with a record of each change, and messages. Demo pages: `/listings` and `/applications`.
Both use app-owned Postgres with numbered migrations and the shared fake.

Feed and messaging: [feed](registry/feed/README.md) adds posts with photos, likes, comments and
follows, a paged home feed and a person's posts on their profile page;
[messaging](registry/messaging/README.md) adds one-to-one conversations with unread counts and read
state, updated by polling. Demo pages: `/feed` and `/messages`. Both use app-owned Postgres and go
through moderation for reports and blocks.
Optional text screening is off by default; image screening is recorded in gap 76.
