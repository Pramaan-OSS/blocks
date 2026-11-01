# Checkout (`checkout`)

Take a payment on a hosted payment page. Licence: AGPL-3.0.

## Install

```bash
npx shadcn@4.23.0 add https://raw.githubusercontent.com/Pramaan-OSS/blocks/main/public/r/checkout.json
```

It adds the files below, the shadcn `button` and `badge` components, and the `@pramaan/sdk` and
`server-only` packages. No other dependency: the payment page is the provider's own, opened by a
link. Set `PRAMAAN_API_KEY` on the server, and `APP_URL` if the app sits behind a proxy (it is used
for the pages the customer returns to).

## Look

The block reads the Pramaan theme (`theme.json`). Install it once and load its fonts with
`pramaanFonts` on `<html>`; steps are in the repo README. The payment page itself is the
provider's and is not restyled.

## Use

Edit `lib/pramaan/checkout-plans.ts` to list what you sell. **The browser sends only a plan key**;
the price is read on the server, so a visitor can't pay less by editing the request.

```tsx
import { CheckoutButton } from "@/components/pramaan/checkout/checkout-button";

<CheckoutButton plan="starter" label="Pay for Starter" />
```

The block ships the return page `app/checkout/done/page.tsx` (it shows `CheckoutStatus`). Point your
own "cancel" page at `/checkout` or change `cancelUrl` in `lib/pramaan/checkout.ts`.

| Component | Prop | Default | What it does |
|---|---|---|---|
| `CheckoutButton` | `plan` | required | the key of a plan in `checkout-plans.ts` |
| | `label` | "Pay now" | button text |
| | `email` | none | prefills the customer's email |
| | `onRedirect` | `location.assign` | how to open the payment page |
| `CheckoutStatus` | `pollMs` | 3000 | how often to check while waiting |
| | `backHref` | `/checkout` | where "Back to the checkout" goes |

## What it shows

- A button that makes one payment page per click (a double click can't make two) and sends the
  customer there.
- A status card: waiting, paid, cancelled, expired or declined, in plain words. It says paid only
  when a payment was captured; an unclear answer reads as "checking", never as paid.
- The reference for the payment stays in the customer's browser and is never shown.

## Calls it makes

Server only, from `app/api/pramaan/checkout/`, with `PRAMAAN_API_KEY`:

| Route in your app | Pramaan call |
|---|---|
| `POST /api/pramaan/checkout` | `payments.checkout.create` (one-time, or a repeating plan) |
| `GET /api/pramaan/checkout?ref=` | `payments.checkout.get` |

Which provider takes the payment is Pramaan's routing, not this block's, and no provider is named
anywhere in the screens or errors. Try it on the fake with `PRAMAAN_FAKE=1 pnpm dev` and open
`/checkout`: the payment page is a marked stand-in with Pay and Cancel buttons.

## Files

| File | Part |
|---|---|
| `lib/pramaan/checkout-plans.ts` | what you sell (edit this) |
| `lib/pramaan/checkout.ts` | server logic |
| `app/api/pramaan/checkout/route.ts` | route handler |
| `app/checkout/done/page.tsx` | where the customer lands after paying |
| `components/pramaan/checkout/checkout-button.tsx` | the button and the status card (named apart from `lib/pramaan/checkout.ts`, or the shadcn CLI rewrites one import to point at itself) |
| `lib/pramaan/*`, `components/pramaan/*` | shared by every block |
