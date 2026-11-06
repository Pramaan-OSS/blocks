# Messaging

MIT. One-to-one conversations between signed-in people: a list with unread counts, a thread with
send, read state, report and block. **New messages arrive by polling**, every 3 seconds in an open
conversation and every 5 seconds in the list. Copyable Next.js App Router block using shadcn parts,
Tailwind and the shared Pramaan theme.

## Install and connect

Install `public/r/messaging.json` with `npx shadcn@4.23.0 add <path-or-url>`, then apply these to
your Postgres database, in this order, and set `DATABASE_URL`:

```sh
# In src/db/migrations if the app has a src folder, otherwise db/migrations.
dir=db/migrations; [ -d src/db/migrations ] && dir=src/db/migrations
for f in crm_profiles_001 crm_moderation_001 crm_moderation_002 crm_messaging_001; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$dir/$f.sql"
done
```

Each file can safely run again. Wire `currentMemberId` to your verified sign-in and `socialContext`
to verified community membership, then set `PRAMAAN_SOCIAL_SCOPE`, the same scope as your other
community blocks. Production sign-in denies access until wired. `PRAMAAN_FAKE=1` uses the demo
sign-in and an in-memory store, with no credentials.

## Use

```tsx
import { MessagingPanel } from "@/components/pramaan/messaging/messaging-panel";

<MessagingPanel />
```

| Prop | Default | What it does |
|---|---|---|
| `pollMs` | 3000 | how often the open conversation is checked |
| `listPollMs` | 5000 | how often the conversation list is checked |
| `getBotCheckToken` | none | supplies a token when `PRAMAAN_BOT_CHECK_SECRET` is set |

Link to the page with `?with=<person>` to start or reopen a conversation with someone. The feed
block's `messagesHref` does this from a profile page. Enter sends, Shift+Enter adds a line, and
Enter belongs to an input method while it is composing, as in the `chat` block.

## Who can see what

- **Only the two people.** The server checks a participant on every read and write. A stranger gets
  the same answer as a missing conversation. A conversation appears for the other person once it
  has a message.
- **Names.** The list shows a display name only if the person made it public, otherwise "Community
  member". Their member reference reaches the browser for blocking; it is never shown.
- **Blocks.** A block in either direction refuses messages and new conversations both ways, and the
  conversation leaves both lists. Unblocking brings it back with its history.
- **Reviewers.** Reports go through the moderation block; install `moderation` for the queue.
  Someone can report only a message the other person sent. Reviewers see that message (up to 280
  characters) and nothing else from the conversation. Hiding it removes it for both people. Tell
  your members this in your privacy policy.
- Messages are stored as plain text in your database. They can't be edited or deleted yet.

## Optional email notice

Off by default. Set `PRAMAAN_MESSAGE_EMAIL=1` and wire `memberEmail(person, scope)` in
`lib/pramaan/social-context.ts` to the person's confirmed address; it returns nothing by default, so
nothing is sent. The notice goes through the platform email module the same way as the
`email-notices` block: `POST /v1/email`, one key per run of unread messages, so several messages
before the person reads them send one notice. It uses fixed words and carries nothing a person
typed. It runs after the reply and a failure never affects the send. Outside a Pramaan app there is
no module, so nothing is sent (gap 79). The `email.send` capability isn't used, because each send
would wait in the approvals inbox.

## Limits

Origin checks, a per-person limit of 60 writes and 240 reads a minute, a higher per-address ceiling
for shared offices, and the optional bot check, all through `public-guard.ts`. An open conversation
and the list use about 32 of those reads a minute. With the email notice on, those limits still let
one member email up to 60 different people a minute by starting conversations; the words are fixed,
but it is unasked-for mail, so lower `MEMBER_WRITE_LIMIT` in `social-context.ts` or limit who can
start a conversation first. Counters are per server process. Messages are up
to 4,000 characters; a conversation loads 50 at a time; the list shows the 100 most recent
conversations. Storage is one row per conversation and message (`crm_conversation`, `crm_message`).
No new runtime dependency. Demo: `/messages` with `PRAMAAN_FAKE=1 pnpm exec next dev -p 3331`.
