# Identity check (`identity-check`)

Check a person's identity with an ID document and a selfie. Licence: MIT.

## Install

```bash
npx shadcn@4.23.0 add https://raw.githubusercontent.com/Pramaan-OSS/blocks/main/public/r/identity-check.json
```

It adds the files below, the shadcn `button` and `badge` components, and the `@pramaan/sdk` and
`server-only` packages. **No other dependency**: the provider's own screen is shown in an iframe (or a
new tab) from the link the API returns, so no provider package is installed. Set `PRAMAAN_API_KEY` on
the server. Edit `lib/pramaan/session.ts` so `currentEndUserRef` returns your signed-in user's id
(letters, digits, `_ . -`; never an email or name); it is sent as the person's reference.

## Look

The block reads the Pramaan theme (`theme.json`). The provider's own screen is not re-skinned.

## Use

```tsx
import { IdentityCheck } from "@/components/pramaan/identity/identity-check";

<IdentityCheck language="en" />
```

| Prop | Default | What it does |
|---|---|---|
| `language` | the provider's default | two-letter language for the person's screen |
| `pollMs` | 4000 | how often to check while the person is verifying |

## What it shows

- **Check my identity** makes one check per click and shows the provider's own screen in the page
  (camera and microphone allowed), with "Open the check in a new tab" as a way out.
- **A status card** after: verified, being reviewed, not verified, expired or stopped, in plain
  words, with each check's result (ID document, selfie check, face match). It updates by itself and
  offers "Try again" after a failure. Anything unclear reads as waiting, never as verified.
- **Personal data stays out.** The API's answer carries the name, date of birth and document number
  the check read. The route passes on the decision and the check results only; fetch the facts
  yourself on the server if you need them, and treat them as personal data.
- With `PRAMAAN_FAKE=1` the screen is a clearly marked stand-in with Pass and Fail buttons.

The reference for a check is kept in the browser's page state and is never shown. Anyone who holds it
can read that check's decision (not the personal facts), so don't put it in a URL you share.

## Calls it makes

Server only, from `app/api/pramaan/identity/`, with `PRAMAAN_API_KEY`:

| Route in your app | Pramaan call |
|---|---|
| `POST /api/pramaan/identity` | `identity.verification.create` (with your user reference and the click's idempotency key) |
| `GET /api/pramaan/identity?ref=` | `identity.verification.get` |

No provider is named in the screens or errors. Try it with `PRAMAAN_FAKE=1 pnpm dev` and open `/identity`.

## Files

| File | Part |
|---|---|
| `lib/pramaan/identity.ts` | server logic and types |
| `app/api/pramaan/identity/route.ts` | route handler |
| `components/pramaan/identity/identity-check.tsx` | the start button, the provider's screen and the status card |
| `lib/pramaan/*`, `components/pramaan/*` | shared by every block |
