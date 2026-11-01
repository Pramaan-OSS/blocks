# E-signature (`e-sign`)

Send a document to be signed by email, see who has signed, remind the ones who haven't, and open
the signed copy. Licence: MIT.

## Install

```bash
npx shadcn@4.23.0 add https://raw.githubusercontent.com/Pramaan-OSS/blocks/main/public/r/e-sign.json
```

It adds the files below, the shadcn `button`, `input`, `label`, `alert-dialog` and `badge`
components, and the `@pramaan/sdk` and `server-only` packages. No other dependency: the signers
sign on the signing service's own page, opened from the email. Set `PRAMAAN_API_KEY` on the server.

## Look

The block reads the Pramaan theme (`theme.json`). Install it once and load its fonts with
`pramaanFonts` on `<html>`; steps are in the repo README. The signing page itself is the service's
and is not restyled.

## Use

The document to sign is a file you already uploaded: pass its id (the `upload` block makes them).

```tsx
import { SendForSignature, SigningList } from "@/components/pramaan/signing/signing-flow";

<SendForSignature documents={[{ fileId: "file_01ARZ3NDEKTSV4RRFFQ69G5FAV", filename: "agreement.pdf", label: "Service agreement" }]} />
<SigningList />
```

| Component | Prop | Default | What it does |
|---|---|---|---|
| `SendForSignature` | `documents` | required | what the person may choose from: `fileId`, `filename` (PDF, PNG or JPEG), optional `label` |
| `SigningList` | `pollMs` | 10000 | how often to refresh; opening a row shows each signer, a reminder button and the signed copy |

## What it shows

- A form: title, who signs (1 to 20 people, name and email). One click sends once, even if it is
  clicked twice. Each signer gets one signature box on page 1.
- A list of what was sent, with plain states: waiting, opened, partly signed, signed by everyone,
  declined, cancelled, expired.
- A detail view with each signer's state. A reminder asks first, and only offers people who have
  not signed. The signed copy opens only once everyone has signed.
- If the send is held for a team member's yes, the form says so; the call then waits in the
  approvals inbox (the `approvals` block).
- The references stay in the browser and are never shown.

## Calls it makes

Server only, from `app/api/pramaan/signing/`, with `PRAMAAN_API_KEY`:

| Route in your app | Pramaan call |
|---|---|
| `POST /api/pramaan/signing` | `signature.request.send` |
| `GET /api/pramaan/signing` | `signature.requests.list` |
| `GET /api/pramaan/signing/[ref]` | `signature.request.get` |
| `POST /api/pramaan/signing/[ref]/remind` | `signature.request.remind` |
| `GET /api/pramaan/signing/[ref]/download` | `signature.request.download` |

Which service handles the signing is Pramaan's routing, and no provider is named anywhere in the
screens or errors. **Sending and reminding are real, outward actions:** put your own sign-in check
in front of these routes. Try it on the fake with `PRAMAAN_FAKE=1 pnpm dev` and open `/e-sign`: a
marked stand-in for the signing page lets you open the link and sign.

## Files

| File | Part |
|---|---|
| `lib/pramaan/signing.ts` | server logic |
| `app/api/pramaan/signing/**/route.ts` | route handlers |
| `components/pramaan/signing/signing-flow.tsx` | the form, the list and the detail view |
| `lib/pramaan/*`, `components/pramaan/*` | shared by every block |
