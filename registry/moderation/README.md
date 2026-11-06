# Moderation

MIT. Copyable Next.js App Router block using shadcn buttons, Tailwind and the shared Pramaan theme.
Load the theme's Geist, Fraunces and JetBrains Mono fonts through `pramaanFonts` on the host's html element.

## Install and connect

Install `public/r/moderation.json` with `npx shadcn@4.23.0 add <path-or-url>`.
Apply `crm_moderation_001.sql`, then `crm_moderation_002.sql`, from `db/migrations/`, or
`src/db/migrations/` if the app has a `src` folder, to the app's Postgres database and set
`DATABASE_URL`. No database is provisioned by this block.

Set `PRAMAAN_SOCIAL_SCOPE` to the community/workspace reference, and wire `socialContext`
to the host's **verified** session and workspace membership. Wire `mayModerate` to trusted
owner/admin roles. Production denies all moderator access until this is done. Neither a
submitted role nor a browser cookie is a production identity. `PRAMAAN_FAKE=1` enables the
existing in-memory store and demo-only identity cookie, with owner and admin reviewers.

Render `SafetyActions` with `{kind, target, label}` beside host items and people. The host
supplies `target`; users see `label`. Render `ModerationPanel` only where reviewers should
see the queue; the API independently enforces access. Reports require a reason. Repeated
open reports by the same reporter for the same target are deduplicated. Decisions are
serialized in Postgres and record the actual member reference and server time. Dismissing
keeps content visible. Hiding applies only to items; person reports can be dismissed or
handled through the host's own account controls. No account is automatically deleted.

Every host content read must filter `await isHidden(itemRef, scope)` and
`await isBlocked(viewer, author, scope)`. Blocking is directional and survives reloads.
Unblocking is available. The profile public-read helper already checks blocking. This
block cannot intercept arbitrary host queries; apply these helpers to feeds, searches,
listings, comments and messages in the consuming kit. Internal references stay in data,
never visible screen text. Wire `moderationSubject` to a scope-checked local content lookup for a plain label and
excerpt of each reported item. Person reports link to the public profile. The demo supplies
a sample post excerpt. The queue defaults to numbered reports when no lookup is connected. A block can instead pass a
`subject` to `reportTarget` or `checkNewText`; it is stored on the report and shown first, as the
feed and messaging blocks do. A report sent through this route stores what `moderationSubject`
finds at that moment when it has an excerpt, which is how a listing's title and description reach
the queue, so a later edit doesn't change what reviewers read. A repeat by the same reporter while
the report is open keeps one report, and its excerpt follows the newest one. For several items,
`blockedEitherWay`, `canSee` and `visibleSql` apply the same rules, `visibleSql` inside one list
query so paging stays correct.
For a single configured community, `isBlocked(viewer, other)` and `isHidden(itemRef)`
also work without an explicit scope.

## Optional text screening

Off by default. The owner sets `PRAMAAN_TEXT_SCREENING=1` to enable it and connects the
shared Pramaan server helper. Call `checkNewText(scope, {kind, ref}, text)` for each new
host text; profile saves already call it. Only `text.classify` is used. The current API
accepts `{text}` only, despite describing custom categories. Local review categories are
abusive, spam, sexual and safe. Flagged labels, unrecognized results, pending answers and
failed checks create an automatic report; a confident explicit safe label skips review.
Confidence is conservatively treated as 0–1; uncertain results need human review. No text
check hides or deletes content. This is advisory classification, not a guaranteed safety
filter. Image screening is unavailable (gap 76); custom input categories are gap 77.
No live or paid calls were made during development.

## Public route protection and limits

Routes reuse `public-guard.ts`: trusted client IP, rate limits and optional bot verification.
Set `PRAMAAN_SOCIAL_ORIGIN` when a proxy rewrites the public origin. Set
`PRAMAAN_BOT_CHECK_SECRET` to enable the existing bot check, and pass `getBotCheckToken` to
both UI components. It must return a token from the host's security-check integration.
No bot vendor is called directly. Configure trusted proxy headers before publishing;
otherwise clients share the higher no-IP limit. Counters are per process; use a shared
limiter for multiple servers. Bodies are bounded, JSON only, and mutations check origin.

Storage is one row per report, block, hidden item and decision (`crm_report`, `crm_block`,
`crm_hidden_item`, `crm_moderation_audit`), with indexes for the queue and each lookup.
`isBlocked` and `isHidden` are single indexed lookups. A partial unique index keeps one open
report per reporter and target; a conditional update lets one of two concurrent reviewers win.
The queue returns up to 200 reports, open first, with plain labels only: no block lists,
reporter or content references. `moderationAudit(scope)` returns who decided what and when.
Hosts own retention of old reports.
No new runtime dependency beyond the existing Postgres and Pramaan helpers.

Demo: `/moderation`; run `PRAMAAN_FAKE=1 pnpm exec next dev -p 3311`.
