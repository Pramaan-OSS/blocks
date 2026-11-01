# Account (`account`)

Show a signed-in person who they are, their organisation's name and, to owners and admins, the team.
Licence: AGPL-3.0.

## Install

```bash
npx shadcn@4.23.0 add https://raw.githubusercontent.com/Pramaan-OSS/blocks/main/public/r/account.json
```

It adds the files below, the shadcn `button`, `input` and `label` components, and the `@pramaan/sdk`
and `server-only` packages. No other dependency. Set `PRAMAAN_API_KEY` on the server. Set
`PRAMAAN_DASHBOARD_URL` to show an "Open the dashboard" link.

## Look

The block reads the Pramaan theme (`theme.json`). Install it once and load its fonts with
`pramaanFonts` on `<html>`; steps are in the repo README.

## Use

```tsx
import { AccountPanel } from "@/components/pramaan/account/account-panel";

<AccountPanel />
```

Who is signed in comes from `lib/pramaan/session.ts`, the same hook every block uses: return the
Pramaan `member_id` your sign-in maps to. Nobody signed in gets "Sign in to see your account."

## What it shows

- **You:** your email, your role in words (owner, admin, member, viewer), whether you can approve
  requests, and your spending limit.
- **Organisation:** the name people outside your team see when you contact them. Owners and admins
  can change it; everyone else sees it read-only.
- **Team:** owners and admins see each person's email, role and spending limit. Everyone else is
  told only owners and admins see it. No member id is ever sent to the browser.
- **Keys and members:** a note that API keys, invitations, roles and spending limits are managed in
  the dashboard.

## Calls it makes

Server only, from `app/api/pramaan/account/`, acting as the signed-in member:

| Route in your app | Pramaan call |
|---|---|
| `GET /api/pramaan/account` | `GET /v1/members/me`, `GET /v1/organization`, and `GET /v1/members` for owners and admins |
| `PUT /api/pramaan/account/organisation` | `PUT /v1/organization` (owners and admins; the API checks again) |

Try it on the fake with `PRAMAAN_FAKE=1 pnpm dev`, open `/account`, and use the demo's sign-in buttons.

## Files

| File | Part |
|---|---|
| `lib/pramaan/account.ts` | server logic |
| `app/api/pramaan/account/route.ts`, `app/api/pramaan/account/organisation/route.ts` | route handlers |
| `components/pramaan/account/account-panel.tsx` | the screen |
| `lib/pramaan/*`, `components/pramaan/*` | shared by every block |
