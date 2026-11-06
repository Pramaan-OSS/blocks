# Applications

MIT. Copyable Next.js App Router block using shadcn buttons, Tailwind and the shared Pramaan theme.
Load the theme's Geist, Fraunces and JetBrains Mono fonts through `pramaanFonts` on the host's html element.

People apply to a listing with a message and an optional file, and see each application's status.
The listing's owner sees applicants, moves them through new, shortlisted, declined and accepted, and
messages them. Each status change records who made it and when.

## Install and connect

Install `public/r/applications.json` with `npx shadcn@4.23.0 add <path-or-url>`. It brings the whole
listings block. Apply the migrations in this order and set `DATABASE_URL`:
`crm_moderation_001.sql`, `crm_moderation_002.sql`, `crm_listings_001.sql`, then
`crm_applications_001.sql`, all in `db/migrations/`, or `src/db/migrations/` if the app has a `src`
folder.

Wire the listings block first (its README). Then pass `withApplications` to `ListingDetail` and
`MyListings`, and wire `confirmedEmail` in `lib/pramaan/application-notice.ts` to your accounts.

| Page | Who | What |
|---|---|---|
| `/listings/[listing]/apply` | signed-in people | `ApplyPanel`: the application form |
| `/listings/[listing]/applicants` | the listing's owner | `ApplicantsPanel`: applicants, status, messages |
| `/applications` | signed-in people | `MyApplications`: their own applications |

All three components take `getBotCheckToken`.

## Who sees what

- One application per person and listing. No one can apply to their own listing, or to one that is
  closed, hidden or blocked either way. A closing listing can't race an application.
- An applicant sees only their own applications. If the listing is later hidden or blocked, they
  keep their own status and text, and lose its title, link and messages.
- A listing's owner sees applicants on their own listings only; anyone else gets the same "isn't
  available" answer. An applicant blocked either way leaves the list and can't be moved or messaged.
- Owners never see an applicant's email address. The name is what the applicant typed.
- Only the owner moves a status. Two moves of the same version can't both land, and the change and
  its record are saved together. `crm_application_event` keeps the old status, new status, member and
  time; screens show "you", "the listing owner" or "the applicant", never a reference.

## Messages and email

The owner's message is saved in the app, and the applicant reads it under their application. One
notice email tells them it's there. This follows the `email-notices` block's rules, which that block
does not yet ship here (see `GAPS.md`, gap 79):

- It goes only to an address the person confirmed, from `confirmedEmail`. Production returns none until
  you wire it, so nothing is emailed and the owner is told plainly. An address is never read from a form.
- The subject is fixed text. What a person typed reaches the email only as the listing's title, on one
  line and at most 60 characters. The owner's message stays out of it, so this can't be used to mail
  arbitrary text under your name. Status changes send no email.
- Each draft has one id, stored before anything is sent, so a repeat sends once. The email's
  `Idempotency-Key` comes from the message's id.
- A failed email never fails the save. The outcome (`sent`, `pending`, `not-sent`, `unknown`) is stored
  with the message; no address is stored or logged.

Choose how it leaves with `PRAMAAN_NOTICE_TRANSPORT`:

| Setting | Goes through | Needs |
|---|---|---|
| `module` (default) | The kit's private app email module, as the password-reset block does | The kit runtime's module socket |
| `capability` | `email.send` with `sender: "domain"` | `PRAMAAN_NOTICE_FROM` on a domain you verified |

`email.send` can't be undone, so with `capability` each email waits for a yes in your approvals, and
the approver sees the address. Use `module` where that doesn't fit. In a kit with the email-notices
block, replace the body of `notifyApplicant` with its `notify` call.

## Files

The optional file goes through the upload block's server helpers: PDF, PNG, JPEG, WebP or plain text,
up to 10 MB, one per application. Only the applicant and the listing's owner get its link. The
server records which file the applicant started and checks the finished file. The application is
saved first, so a failed upload loses nothing and the file can be added later from `/applications`.
**Uploaded files are deleted after 7 days** (gap 78); after that, screens say the file has expired.

## Limits

The routes share the listings guard: origin check, per-client limits and the optional bot check. Each
member can also send 20 applications, 20 messages and start 30 files an hour. Lists show the newest
200. Application text is not screened by `checkNewText`, since only the listing's owner reads it;
they can report or block the person from the applicant card.

No new runtime dependency beyond the existing Postgres and Pramaan helpers.

Demo: `/applications`, and `/listings/mine` for applicants; run `PRAMAAN_FAKE=1 pnpm exec next dev -p 3321`.
