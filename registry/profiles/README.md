# Profiles

MIT. A public profile and an editor for the signed-in person's name, short bio, five HTTPS
links and a photo. Every field starts private. The public API constructs an allowlist of
explicitly public fields; it never sends a private field or stored file reference.

Install `public/r/profiles.json` with `npx shadcn@4.23.0 add <path-or-url>`.
The block includes its moderation server helpers and three numbered migrations in
`db/migrations/`, or `src/db/migrations/` if the app has a `src` folder:
`crm_profiles_001.sql`, `crm_moderation_001.sql` and `crm_moderation_002.sql`.
Apply all three to the host's Postgres database before serving, and set `DATABASE_URL`. Each
profile is one `crm_profile` row with parameterized queries and a matching in-memory fake.
A revision prevents a stale edit overwriting a newer save. No database or auth service is provisioned.

Wire the shared `currentMemberId` to verified host sign-in and `socialContext` to verified
workspace membership, then set `PRAMAAN_SOCIAL_SCOPE`. Use the same scope for profiles and
moderation. Production sign-in denies access until wired. See the moderation README for
owner/admin role checks, origin configuration, trusted proxy headers, bot checks and
optional advisory text screening. `PRAMAAN_FAKE=1` uses the shared demo sign-in and fake
storage, with no credentials. Owner-only text screening is off by default.

Render `ProfilePanel` for editing. Its `getBotCheckToken` callback supplies a security-check
token when the existing public bot guard is enabled. The installed public page is
`/profiles/[person]`, backed by `PublicProfilePanel`. A public read also calls
`isBlocked` in both directions: a block hides the profile from its blocker, and the blocked
person sees nothing of the blocker's profile. Other
host reads must call the exported moderation helpers themselves.

Photos go through the existing upload block's `startUpload` and `finishUpload` helpers.
The browser sends bytes to the storage link issued by Pramaan; no vendor SDK is used.
The profile endpoint authenticates starts and finishes and binds the pending file reference
to the signed-in person. It rejects another person's file reference, SVG, nonimages and
files over 5 MB, checking the size and type of the file that arrived. Accepted formats: PNG,
JPEG and WebP. A rejected file is deleted, and so is the previous photo once a new one is
saved. A newer upload invalidates the older pending reference. A photo becomes public only when the photo visibility checkbox is set.

File links expire according to the existing upload contract. Expired photos are omitted
from public responses; upload a new photo to replace one. Hiding a field stops future
public responses but cannot revoke a link already copied by a visitor. Storage cleanup and
retention belong to the consuming app. There is no automatic image screening (gap 76).

Uses shadcn buttons, Tailwind and shared theme variables. Install the theme, import its CSS
after Tailwind, and apply `pramaanFonts` to html for Geist, Fraunces and JetBrains Mono.
No new runtime dependency beyond the existing Postgres, upload and Pramaan helpers.
Demo: `/profiles`; run `PRAMAAN_FAKE=1 pnpm exec next dev -p 3311`.
