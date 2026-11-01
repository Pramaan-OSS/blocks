# Subscriptions (`subscriptions`)

Show a customer their plan and send them to the hosted billing page to change their card, see
invoices or cancel. Licence: AGPL-3.0.

## Install

```bash
npx shadcn@4.23.0 add https://raw.githubusercontent.com/Pramaan-OSS/blocks/main/public/r/subscriptions.json
```

It adds the files below, the shadcn `button` component, and the `@pramaan/sdk` and `server-only`
packages. No other dependency: the billing page is the provider's own, opened by a link. Set
`PRAMAAN_API_KEY` on the server, and `APP_URL` if the app sits behind a proxy (it is used for the
page the customer returns to). Your billing account must be connected to Pramaan.

## Look

The block reads the Pramaan theme (`theme.json`). Install it once and load its fonts with
`pramaanFonts` on `<html>`; steps are in the repo README. The billing page itself is the
provider's and is not restyled.

## Use

Edit `lib/pramaan/subscriptions-customer.ts` so it returns the billing customer id you saved for the
signed-in person. **The browser never sends a customer id**, so a visitor can only see and manage
their own plan.

```tsx
import { PlanCard } from "@/components/pramaan/subscriptions/plan-card";

<PlanCard emptyHref="/pricing" />
```

| Prop | Default | What it does |
|---|---|---|
| `emptyHref` | `/checkout` | where someone with no plan can pick one |
| `onRedirect` | `location.assign` | how to open the billing page |

The customer comes back to `/subscriptions` after the billing page; to return elsewhere, send a
`returnPath` (a path on your site only) to the portal route.

### Metered billing

`recordUsage(customerId, event, properties?, key?)` in `lib/pramaan/subscriptions.ts` records one
usage event. Call it from your own server code. There is deliberately **no route** for it: a visitor
must never be able to record their own usage. Pass a `key` so a retry counts once.

## What it shows

- Each plan: the price in dollars and how often ("$29.00 a month"), a status (active, free trial,
  payment overdue, paused, ending, cancelled) and one plain line: when it renews, when it ends, or
  what to do about an overdue payment.
- **Manage billing:** one click makes one short-lived link and opens it.
- No plan: says so and links to where to pick one. No id appears anywhere.

Cancelling is done on the billing page, not by this block: stopping a subscription is an action that
needs a team member's yes when an app makes the call.

## Calls it makes

Server only, from `app/api/pramaan/subscriptions/`, with `PRAMAAN_API_KEY`:

| Route in your app | Pramaan call |
|---|---|
| `GET /api/pramaan/subscriptions` | `billing.subscriptions.list` for the signed-in customer |
| `POST /api/pramaan/subscriptions/portal` | `billing.portal.create` |
| (server code only) `recordUsage` | `billing.usage.record` |

Which billing provider answers is Pramaan's routing, and none is named in the screens or errors.
Try it on the fake with `PRAMAAN_FAKE=1 pnpm dev` and open `/subscriptions`: the billing page is a
marked stand-in where you can cancel.

## Files

| File | Part |
|---|---|
| `lib/pramaan/subscriptions-customer.ts` | which customer is signed in (edit this) |
| `lib/pramaan/subscriptions.ts` | server logic and `recordUsage` |
| `app/api/pramaan/subscriptions/route.ts`, `.../portal/route.ts` | route handlers |
| `components/pramaan/subscriptions/plan-card.tsx` | the plan card |
| `lib/pramaan/*`, `components/pramaan/*` | shared by every block |
