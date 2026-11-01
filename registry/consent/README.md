# Consent and opt-out (`consent`)

Honour STOP and consent in your app. Licence: MIT.

## Install

```bash
npx shadcn@4.23.0 add https://raw.githubusercontent.com/Pramaan-OSS/blocks/main/public/r/consent.json
```

It adds the files below, the shadcn `button`, `input`, `label`, `alert-dialog` and `badge`
components, and the `@pramaan/sdk` and `server-only` packages. Set `PRAMAAN_API_KEY` on the server.
Edit `lib/pramaan/session.ts` so `currentMemberId` returns your signed-in person's member id: the
manager is for signed-in people, and only approvers may let someone be messaged again.

## Look

The block reads the Pramaan theme (`theme.json`). Install it once and load its fonts with
`pramaanFonts` on `<html>`; steps are in the repo README.

## Use

```tsx
import { ConsentBadge, ConsentManager, UnsubscribePage } from "@/components/pramaan/consent/consent-manager";

<ConsentManager />                                  {/* for your team */}
<ConsentBadge address={contact.phone} channel="sms" /> {/* on a contact's page */}
<UnsubscribePage title="Stop hearing from us" />   {/* a public page, no sign-in */}
```

| Component | Prop | Default | What it does |
|---|---|---|---|
| `ConsentBadge` | `address`, `channel` | `sms` | "OK to message" or "Opted out of text messages" for one contact |
| `UnsubscribePage` | `title` | "Stop hearing from us" | Anyone can unsubscribe their own phone number or email |

## What it shows

- **Check a contact:** whether a message to a phone number or email, on a channel, would be refused.
- **Add an opt-out:** for one channel or every channel, with a reason for your own records. Nothing
  you send through Pramaan reaches them on that channel until you remove it.
- **People you won't message:** the list with shortened addresses (the API never returns a whole
  one), who added each (you, an unsubscribe link, or a STOP reply) and a search over the loaded
  entries. "Show more" pages it.
- **Let someone be messaged again** (approvers only): type the whole phone number or email to
  confirm, because the list holds only a shortened form. Only entries you added can be lifted; a
  person's own STOP or unsubscribe stays. Each removal is written to the server log with who did it
  and on which channel, never the address; point `audit` in `lib/pramaan/consent.ts` at your own audit
  log.
- **Replied STOP:** people who texted STOP to your numbers, read-only. Only they can lift it by
  replying START.
- **The public page** needs no sign-in and gives the same answer whether or not the address was
  listed, so it can't be used to find out who your contacts are. The shared public limiter allows 10 attempts per IP per minute on
  `POST /api/pramaan/consent/unsubscribe`, before calling Pramaan. Counters are per server instance;
  use a shared store for several instances. The guard uses `PRAMAAN_TRUSTED_PROXY_HOPS` (default 1)
  from the right of `x-forwarded-for`. It trusts `x-real-ip` only with
  `PRAMAAN_TRUSTED_IP_HEADER=x-real-ip` and a proxy that overwrites that header. Without a usable IP,
  stop requests share a separate 100-attempts-per-minute fallback bucket. A one-time warning reminds
  the owner to configure trusted proxy headers before publishing.

## Calls it makes

Server only, from `app/api/pramaan/consent/`, with `PRAMAAN_API_KEY`. All four are free:

| Route in your app | Pramaan call |
|---|---|
| `GET /api/pramaan/consent?cursor=` | `messaging.opt-outs.list` |
| `GET /api/pramaan/consent/check?address=&channel=` | `messaging.opt-out.check` |
| `POST /api/pramaan/consent` | `messaging.opt-out.add` |
| `POST /api/pramaan/consent/remove` | `messaging.opt-out.remove` with `confirm: true` |
| `POST /api/pramaan/consent/unsubscribe` | `messaging.opt-out.add` (public) |

Try it on the fake with `PRAMAAN_FAKE=1 pnpm dev` and open `/consent` and `/stop`.

## Files

| File | Part |
|---|---|
| `lib/pramaan/consent.ts` | server logic and types |
| `app/api/pramaan/consent/**` | route handlers |
| `components/pramaan/consent/consent-manager.tsx` | the screens |
| `lib/pramaan/*`, `components/pramaan/*` | shared by every block |
