# Feed

MIT. Posts with optional photos, likes, comments and follows. A home feed of your own posts and
the people you follow, newest first, with cursor paging. A person's posts sit on their profile
page. Copyable Next.js App Router block using shadcn parts, Tailwind and the shared Pramaan theme.

## Install and connect

Install `public/r/feed.json` with `npx shadcn@4.23.0 add <path-or-url>`. It brings the profile and
moderation helpers it needs, and replaces `app/profiles/[person]/page.tsx` with a version that shows
the person's posts, so accept the overwrite if you already installed `profiles`.

Apply these to your Postgres database, in this order, and set `DATABASE_URL`:

```sh
# In src/db/migrations if the app has a src folder, otherwise db/migrations.
dir=db/migrations; [ -d src/db/migrations ] && dir=src/db/migrations
for f in crm_profiles_001 crm_moderation_001 crm_moderation_002 crm_feed_001; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$dir/$f.sql"
done
```

Each file can safely run again. No database is provisioned by this block.

Wire `currentMemberId` to your verified sign-in and `socialContext` to verified community
membership, then set `PRAMAAN_SOCIAL_SCOPE`. Use the same scope for profiles, moderation, feed and
messaging. Production sign-in denies access until wired. `PRAMAAN_FAKE=1` uses the demo sign-in and
an in-memory store, with no credentials.

## Use

```tsx
import { FeedPanel, PersonPosts } from "@/components/pramaan/feed/feed-panel";

<FeedPanel />
<PersonPosts person={person} messagesHref="/messages" />
```

| Prop | Default | What it does |
|---|---|---|
| `profilesHref` | `/profiles` | where a person's name links to |
| `messagesHref` | none | shows a Message link on a person's page; pass it when the app has the `messaging` block |
| `getBotCheckToken` | none | supplies a token when `PRAMAAN_BOT_CHECK_SECRET` is set |

People follow each other from a profile page. There is no people directory or search: link to
profile pages from wherever your app lists people.

## Who can see what

- **Members only.** Every read and write needs a signed-in person. A signed-out visitor to a profile
  page sees the public profile and a line saying members can see the posts. This also means a
  blocked person can't read posts by signing out.
- **Names.** A post shows the author's display name only if they made it public on their profile,
  otherwise "Community member". Their member reference travels to the browser for profile links,
  following and blocking; it is never shown.
- **Blocks and hidden items.** A block in either direction removes posts and comments for both
  people and refuses likes, comments, reports and follows between them. Hidden posts and comments
  show to nobody, including their author. List queries apply this in the query itself (`visibleSql`),
  so a page is never short and a cursor never skips; single items use `canSee`, which calls
  `isBlocked` and `isHidden`. Following resumes after an unblock.
- **Your own.** Only the author can edit or delete a post or comment. Editing checks the post's
  revision, so a stale edit is refused. Deleting a post removes its likes, comments and photos.

## Reporting

Reports go through the moderation block. Install `moderation` for the owner and admin queue. The
server checks that the reporter can see the item, then stores a label and a 280-character excerpt
on the report (`crm_moderation_002.sql`), so reviewers see what was reported even if it is later
edited or deleted. Hosts own retention of old reports. Hiding happens in the queue: `post:<id>` and
`comment:<id>` are the item references.

## Optional text screening

Set `PRAMAAN_TEXT_SCREENING=1` to send new and edited posts and comments through `text.classify`,
the way moderation does. It is off by default and only adds a report; it never hides anything.
Each check is a paid call and the write limit below allows 60 a minute per person, so lower
`MEMBER_WRITE_LIMIT` in `social-context.ts` if you turn it on for a large community.

## Photos

Up to four PNG, JPEG or WebP photos of up to 5 MB each. They go straight to storage through the
`upload` block's helpers. Each upload is bound to the person who started it, and a post can claim
only its author's finished uploads, once. The type and size of the file that arrived are checked,
and a refused file is deleted. Photos can't be changed after posting.

**Stored files expire.** The upload contract keeps a file for a limited time (7 days today), and an
expired photo drops out of its post while the text stays. See gap 78 in `GAPS.md`. There is no
automatic image screening (gap 76); people can report a post.

## Limits

Origin checks, a per-person limit of 60 writes and 240 reads a minute, a higher per-address ceiling
for shared offices, and the optional bot check, all through `public-guard.ts`. Counters are per
server process; use a shared limiter for several servers. Configure trusted proxy headers before
publishing (see the moderation README). Posts are up to 2,000 characters, comments up to 1,000, and
a post shows its newest 50 comments.

Storage is one row per post, like, comment, follow and unfinished upload (`crm_post`,
`crm_post_like`, `crm_comment`, `crm_follow`, `crm_feed_upload`). No new runtime dependency beyond
the existing Postgres, upload and Pramaan helpers. Demo: `/feed` with `PRAMAAN_FAKE=1 pnpm exec next dev -p 3331`.
