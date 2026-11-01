# Booking (`booking`)

Visitors pick an open time on your connected calendar and book it. Licence: MIT.

## Install

```bash
npx shadcn@4.23.0 add https://raw.githubusercontent.com/Pramaan-OSS/blocks/main/public/r/booking.json
```

It adds the files below, the shadcn `button`, `input` and `label` components, and the `@pramaan/sdk` and
`server-only` packages. Set `PRAMAAN_API_KEY` on the server. **Set `PRAMAAN_BOOKING_HOST`** to the reference
of the person whose calendar is booked (the same reference the `connections` block uses). Without it,
public reads and bookings fail with a setup message; they never use the visitor's calendar. Startup
also warns about the missing setting. If your app already has `instrumentation.ts`, merge the installed
`register()` warning into its existing `register()` function.

## Use

```tsx
import { BookingPicker } from "@/components/pramaan/booking/booking-picker";

<BookingPicker connectionsHref="/connections" />
```

Edit `BOOKING` in `lib/pramaan/booking.ts`: meeting title, length, hours, weekdays, time zone,
how many days ahead, minimum notice, and which calendar apps are tried.

| Prop | Default | What it does |
|---|---|---|
| `connectionsHref` | `/connections` | where “needs connection” sends the owner |
| `days` | 14 (from `BOOKING`) | how many dates to show, 1 to 31; never beyond `daysAhead` |
| `getBotCheckToken` | unset | async callback returning a fresh token from your site's bot-check widget |

## What is protected

- Visitors see open times only, never calendar details. Times outside your hours, weekdays, minimum
  notice, or `daysAhead` are refused even when sent by hand. Past times are always refused.
- Booking attempts are limited by IP address and by email address (spaces removed at the ends and
  letter case ignored, plus tags removed, and Gmail/Googlemail dots and domains combined).
  The original address is kept for the invitation. Email attempts only count after the optional bot check succeeds. There is also a daily cap per host, including requests waiting for approval
  and failed creation attempts, to bound invitations. Counters run before event creation.
- Availability reads are limited by IP. Free/busy results are reused for 60 seconds for the same host,
  calendar app and date range. Concurrent reads share the same call. Failed reads are not cached.
  Booking checks always read fresh data, and a successful write clears cached availability.
- Before creation, a hold on the host and slot prevents a second request in this server process from
  creating the same booking. Failures before creation release it; once an event exists, the hold remains
  until the slot ends, even if a later read or cleanup fails.
  A repeat with the same booking key returns its earlier result while the hold lasts.
- After immediate creation, all pages of `calendar.events.list` for that slot are checked. Of overlapping
  competing events, the earliest creation time wins; equal creation times use the lower reference. All-day,
  cancelled, declined and free/transparent entries are skipped, as are entries outside the slot. Creation
  times are required only on competing overlaps. The winner checks again after one second to catch
  an earlier event that appeared late. Listing is tried up to three times for a transient failure or a
  missing new event. A losing request deletes only its own event, sends a cancellation to the visitor,
  and says “That time was just taken. Pick another.” Free/busy intervals are
  merged, so they cannot do this check on their own.
- A `from` date outside yesterday through `today + daysAhead` in the host's time zone is refused.
  Date ranges with no candidate times return an empty list without any free/busy call.
- The consent block's public stop-page POST uses the same shared limiter: 10 attempts per IP per minute.

## Settings

All limits below are positive whole numbers set on the server. Restart after changing settings.

| Setting | Default | Meaning |
|---|---|---|
| `PRAMAAN_BOOKING_HOST` | required | owner of the calendar; no signed-in-person fallback |
| `PRAMAAN_BOOKING_GET_LIMIT` | 60 | availability reads per IP per 60 seconds |
| `PRAMAAN_BOOKING_IP_LIMIT` | 10 | booking POST attempts per IP per 60 seconds, including invalid forms |
| `PRAMAAN_BOOKING_EMAIL_LIMIT` | 5 | valid booking attempts per email per hour, across IP addresses |
| `PRAMAAN_BOOKING_DAILY_LIMIT` | 50 | creation attempts per host per UTC day; resets at midnight UTC |
| `PRAMAAN_TRUSTED_PROXY_HOPS` | 1 | trusted forwarding hops counted from the right of `x-forwarded-for` |
| `PRAMAAN_TRUSTED_IP_HEADER` | unset | set to `x-real-ip` only when your proxy overwrites that header |
| `PRAMAAN_BOT_CHECK_SECRET` | unset | any nonempty value enables verification through `auth.bot-check.verify`; never sent to that capability |

When the bot check is enabled, connect the widget's verification account in Pramaan and pass
`getBotCheckToken` to the picker to supply a fresh client token on each submission. Direct callers send
`botCheckToken` in the POST body. `PRAMAAN_BOT_CHECK_SECRET` is retained as the server-only enable setting;
the verification account's credentials belong in Pramaan, not in the widget or a direct vendor request.
This block leaves account selection to Pramaan. If multiple connected verification accounts require
disambiguation, pass the documented `Pramaan-Account` header on the bot-check capability call.

The guard calls `auth.bot-check.verify` through the shared Pramaan helper, sending only `token` and an
optional known `remoteIp`. It accepts only `passed: true`. Missing, invalid, expired or rejected tokens
fail before calendar calls. Verification errors fail closed. Without the enable setting, tokens are
ignored and no verification call is made. The widget's public site key belongs in your site's widget setup.

Put this behind a trusted proxy. By default, the IP comes from the right of `x-forwarded-for`, counting
`PRAMAAN_TRUSTED_PROXY_HOPS` entries (default 1). Set that count to match your trusted proxy chain; a
visitor's forged leftmost address must not become the quota identity. Prevent visitors from reaching
the origin around that chain. `x-real-ip` is ignored unless `PRAMAAN_TRUSTED_IP_HEADER=x-real-ip` is set;
only opt in if your own proxy overwrites it. Missing or malformed IPs use the fallback below.

Without a usable proxy IP, requests share a separate `no-ip` bucket at **10 times** the normal limit for
that route: by default 600 booking reads, 100 booking POSTs, or 100 consent stop requests per minute.
Known IPs retain their own normal limits. A one-time startup warning explains that IP limits need a
trusted proxy header; the same reminder runs on first fallback use if startup registration was omitted.
Email limits, the daily cap and any enabled bot check still apply. This shared fallback bounds requests
but can affect unrelated visitors, so configure trusted headers in production. Limiter cleanup scans run
at most once a second; an individual expired counter still resets immediately.

## Known limits

- **Per server instance.** Rate counters, holds and the availability cache live in memory. Restarts clear
  them. Several instances need a shared store for these protections. The post-create event check helps
  reconcile immediate writes across instances; it relies on complete, current event listings and successful
  deletion. If a calendar delays visibility beyond the retries or the second check, races can still remain.
  If checking cannot finish, the event already exists: the route returns booked, keeps its hold until
  slot end, and logs the slot time asking the owner to check the calendar. A failed or pending deletion
  logs both event references as well, so the owner can find the clash. It does
  the same. It does not offer the slot again as though creation had failed.
- **Waiting for a yes.** With an API key, creation can wait for a member's approval. Pending requests hold
  the slot until its end; the old `PRAMAAN_BOOKING_HOLD_MINUTES` setting is no longer used. While someone
  views availability or tries to book, known pending jobs are checked at most every 30 seconds. A confirmed
  denial, expiry, cancellation or failed job releases the hold, including creation failure after approval.
  A successful approval keeps it through the slot. Unavailable job
  status keeps the hold. Once approved, `sendInvites: true` sends the visitor an invitation. There is no
  separate decision-status screen or notification in this block. Across instances or after a restart,
  approvers must still check for clashes: there is no shared reservation store or approval-time conflict check.
- **No cancel or move.** Visitors cannot cancel or reschedule through this block. Conflict cleanup sends
  a cancellation (`sendInvites: true`); it cannot take back the invitation email already sent, and the
  cancellation can itself fail or wait for approval.
- **Cached views can lag.** Calendar changes made elsewhere may take up to 60 seconds to appear in the
  list. The fresh booking check still rejects a taken slot.
- **No live verification in this change.** Tests use the fake. Current capability source supports connected
  selectors and date windows for listing/deletion; the installed SDK's request types lag behind that
  contract, so these calls go through the shared Pramaan helper.

## Calls it makes

Server only, from `app/api/pramaan/booking/`, with `PRAMAAN_API_KEY`:

| Action | Pramaan call |
|---|---|
| `GET /api/pramaan/booking` | `apps.connections.list`, cached `calendar.free-busy.get`; pending holds also read `GET /v1/jobs/{job_id}` |
| `POST /api/pramaan/booking` | optional `auth.bot-check.verify`, `apps.connections.list`, fresh `calendar.free-busy.get`, `calendar.event.create`, then `calendar.events.list` for immediate creation and `calendar.event.delete` if ours loses; pending holds may read `GET /v1/jobs/{job_id}` |

The public names remain `PRAMAAN_BOT_CHECK_SECRET`, `getBotCheckToken`, and `botCheckToken`. All outside
calls, including optional bot verification, go through Pramaan. No vendor is called directly.

## Files

| File | Part |
|---|---|
| `lib/pramaan/booking.ts` | server logic and `BOOKING` settings |
| `lib/pramaan/public-guard.ts` | shared public-route limits and optional bot verification |
| `app/api/pramaan/booking/route.ts` | route handlers; host setup and IP checks |
| `instrumentation.ts` | missing-host and proxy-header startup warnings |
| `components/pramaan/booking/booking-picker.tsx` | the picker |
| `lib/pramaan/*`, `components/pramaan/*` | shared by every block |
