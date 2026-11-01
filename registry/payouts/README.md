# Seller payments and payouts (`payouts`)

Let a seller set up their own payment account and see where it stands. Licence: MIT.

## Install

```bash
npx shadcn@4.23.0 add https://raw.githubusercontent.com/Pramaan-OSS/blocks/main/public/r/payouts.json
```

It adds the files below, the shadcn `button` and `badge` components and the `@pramaan/sdk` and
`server-only` packages, plus **two dependencies for the provider's own setup screen**:
`@stripe/connect-js` 3.5.0 and `@stripe/react-connect-js` 3.5.0. They load only when a real setup
session is opened (`provider-setup.tsx` is a lazy import); in fake mode and for a read-only view
nothing is fetched. Set `PRAMAAN_API_KEY` on the server, and `APP_URL` behind a proxy.
Edit `lib/pramaan/session.ts` so `currentMemberId` returns your signed-in person's member id.

## Look

The block reads the Pramaan theme (`theme.json`). The provider's own screens are not re-skinned:
only their appearance options (colour, radius, font) are set, in `provider-setup.tsx`.

## Use

```tsx
import { PayoutsPanel } from "@/components/pramaan/payouts/payouts-panel";

<PayoutsPanel />
```

No props. It shows the account card for any signed-in person; only an owner or admin sees the
setup button.

## What it shows

- **Payment account:** a pill (ready, setting up, blocked), whether it can take payments and
  receive payouts, and what is still needed in plain words (a bank account, a business website).
- **Set up payments / Give the missing details / Manage payouts:** opens the provider's own embedded
  screen right in the page (onboarding, or the balance and payouts screens once ready).
- An older account that sets up on a hosted page is sent there instead.
- With `PRAMAAN_FAKE=1` the screen is a clearly marked stand-in with a Finish setup button.

The session's secret goes to the signed-in owner's browser once, with `Cache-Control: no-store`.
It is never logged or kept, and an expired session is replaced by a fresh one automatically. Don't
log the response of `POST /api/pramaan/payouts/session` in your own middleware.

## Calls it makes

Server only, from `app/api/pramaan/payouts/`, with `PRAMAAN_API_KEY`:

| Route in your app | Pramaan call |
|---|---|
| `GET /api/pramaan/payouts` | `payments.account.status` |
| `POST /api/pramaan/payouts/session` | `payments.account.connect`, then `payments.account.session.create` |

The screens never name the provider. Try it with `PRAMAAN_FAKE=1 pnpm dev` and open `/payouts`.

## Files

| File | Part |
|---|---|
| `lib/pramaan/payouts.ts` | server logic and types |
| `app/api/pramaan/payouts/**` | route handlers |
| `components/pramaan/payouts/payouts-panel.tsx` | the status card and the setup flow |
| `components/pramaan/payouts/provider-setup.tsx` | the provider's own screen (lazy) |
| `lib/pramaan/*`, `components/pramaan/*` | shared by every block |
