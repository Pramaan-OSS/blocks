# Connections manager (`connections`)

Every connected account in one list: connect, check, reconnect, disconnect. Licence: AGPL-3.0.

Your people connect their own apps (Gmail, Outlook, a calendar) through a hosted sign-in. This block
shows each app's status, starts the sign-in, and handles the return.

## Install

```bash
npx shadcn@4.23.0 add https://raw.githubusercontent.com/Pramaan-OSS/blocks/main/public/r/connections.json
```

It adds the files below (including the return page `app/connections/return/page.tsx`), the shadcn
`button`, `alert-dialog`, `badge` and `table` components, and the `@pramaan/sdk` and `server-only`
packages. Set `PRAMAAN_API_KEY` on the server, and edit `currentEndUserRef` in
`lib/pramaan/session.ts` to return your own id for the signed-in person (1 to 128 letters, digits,
`_`, `.` or `-`; never an email or a name). If your app is behind a proxy, set `PRAMAAN_APP_URL` to
its public address so the sign-in returns to the right place.

## Look

The block reads the Pramaan theme (`theme.json`: colours, type, pills, rows, buttons). Install it
once and load its fonts (Geist, Fraunces, JetBrains Mono) with `pramaanFonts` on `<html>`; steps are
in the repo README. Without it the block still works in your own shadcn theme.

## Use

```tsx
import { ConnectionsManager } from "@/components/pramaan/connections/connections-manager";

<ConnectionsManager
  apps={[{ id: "gmail", label: "Gmail", note: "Connects your own Gmail." }, { id: "outlook", label: "Outlook" }]}
  approvalsHref="/approvals"
/>
```

| Prop | Default | What it does |
|---|---|---|
| `apps` | Gmail, Outlook, Google Calendar, GitHub | What to offer. `id` is the app id Pramaan uses, lowercase. |
| `returnPath` | `/connections/return` | The page people land on after signing in |
| `approvalsHref` | `/` | Where your approvals inbox is (block `approvals`); removing a connection waits there |
| `pollMs` | off | Re-read the list this often |
| `navigate` | this tab | How to open the sign-in link |

`ConnectionReturn` (props `app`, `appLabel?`, `backHref?`, `attempts?`, `everyMs?`) is the return
page's content; the installed page already uses it.

## What it does

| Status | Meaning | Actions |
|---|---|---|
| Connected | working | Check, Disconnect |
| Needs reconnect | expired, failed or disabled | Reconnect, Check, Disconnect, Remove |
| Waiting for sign-in | started, not finished | Continue sign-in, Check |
| Revoked | disconnected | Connect again, Remove |
| Not connected | never connected | Connect |

- **Connect** asks for a sign-in link, then opens it. The person signs in on the hosted page and
  lands on `returnPath?app=...`, which asks for the status again (waiting a few seconds for it to
  turn connected) and says where things stand. Mail and calendar connect the person's *own* Gmail
  or Outlook.
- **Check** re-reads one connection: its state, account label and who it is connected as.
- **Disconnect** asks first, revokes the app's access, and the row reads Revoked.
- **Remove** deletes the connection and its saved credentials. It needs approval, so it waits in
  the approvals inbox and goes once approved.
- **Workspace accounts** lists the accounts your own workspace sends and posts from.
- States: loading, error (the server's own message and next step), needs connection (no key), and a
  live status line for screen readers.

## Calls it makes

Server only, from `app/api/pramaan/connections/`, with `PRAMAAN_API_KEY`:

| Route in your app | Pramaan call |
|---|---|
| `GET connections` | `apps.connections.list`, `apps.connections.list-detailed`, `GET /v1/accounts` |
| `POST connections/start` | `apps.connection.start` (with the return link) |
| `GET connections/{id}` | `apps.connection.get` |
| `POST connections/revoke` | `apps.connection.revoke` |
| `POST connections/delete` | `apps.connection.delete` (with `confirm: true`) |

The API doesn't give these yet: a free list of connectable apps, and ids on the plain list.

Try it on the fake with `PRAMAAN_FAKE=1 pnpm dev` and open `/connections`.

## Files

| File | Part |
|---|---|
| `lib/pramaan/connections.ts` | server logic and types |
| `app/api/pramaan/connections/**` | route handlers |
| `app/connections/return/page.tsx` | the page people land on after signing in |
| `components/pramaan/connections/connections-manager.tsx` | the list and the return content |
| `lib/pramaan/*`, `components/pramaan/*` | shared by every block |
