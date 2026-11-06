# Listings

MIT. Copyable Next.js App Router block using shadcn buttons, Tailwind and the shared Pramaan theme.
Load the theme's Geist, Fraunces and JetBrains Mono fonts through `pramaanFonts` on the host's html element.

People post an item with a title, description, category, price or pay text, location and photos, and
edit or close their own. Anyone can search and filter by text, category, location and price range,
and open a listing page. It suits a job board, a marketplace or a directory.

## Install and connect

Install `public/r/listings.json` with `npx shadcn@4.23.0 add <path-or-url>`.
Apply the migrations to the app's Postgres database, in this order, and set `DATABASE_URL`:
`crm_moderation_001.sql`, `crm_moderation_002.sql`, then `crm_listings_001.sql`, all in
`db/migrations/`, or `src/db/migrations/` if the app has a `src` folder.
No database is provisioned by this block.

Wire `socialScope`, `mayModerate` and `currentMemberId` as the moderation block's README says.
Production refuses signed-in actions until `currentMemberId` returns a verified person. Set
`PRAMAAN_API_KEY` for photo uploads. `PRAMAAN_FAKE=1` turns on the in-memory store and the demo
identity cookie, and no calls leave the app.

Edit `LISTING_CATEGORIES` in `lib/pramaan/listings.ts` for your own site.

```tsx
import { ListingsBrowser, MyListings } from "@/components/pramaan/listings/listings-panel";

<ListingsBrowser />
<MyListings />
```

`app/listings/[listing]/page.tsx` is the public listing page. If you install the applications
block too, pass `withApplications` to `ListingDetail` and `MyListings` so they link its pages.
Both also take `getBotCheckToken`.

## Who sees what

- Search is public. It returns open listings only, with no reference to who posted them.
- A closed listing leaves search and stays readable by its link.
- A listing page gives the poster's reference to signed-in people only, for report and block.
- Only the owner can edit, close or change photos. Every other person gets "This listing isn't
  available", the same answer as for a listing that doesn't exist.
- A listing's moderation reference is `listing:<id>`. Anyone signed in can report it on its page;
  owners and admins hide it in the moderation queue. A hidden listing leaves search, counts and
  its page for everyone except its owner, who sees why.
- Blocking works in both directions, as it does for profiles.

Single reads use the moderation block's `isHidden` and `isBlocked`. Postgres search filters the
same tables in the query instead, so a page is never short and a count never includes a hidden row.
The moderation queue shows a reported listing's title and description, stored when the report is
made, so a later edit doesn't change what reviewers read.

## Search

Plain Postgres: a generated `tsvector` with a GIN index for words, using the `english` setting, so
"plumbers" finds "plumber". Location is a contains match. Rows without a number are left out when a
price range is set. Results are 20 to a page, newest first, up to page 500.

## Optional place lookup

Off by default. Set `PRAMAAN_LISTING_GEOCODE=1` to send a listing's location to
`geo.address.geocode` when it is saved. The matched place name joins the location filter, and
coordinates are stored for a future map or distance search. A failed lookup never stops a save.
A location may be a person's address, so leave this off if your listings hold home addresses.
Each lookup is charged by Pramaan. No lookup runs on the public search route.

## Photos

Photos go through the upload block's server helpers, up to six on a listing: PNG, JPEG or WebP, up
to 5 MB. The server records which file each owner started and checks the finished file, so a person
can't attach another's file. **Uploaded files are deleted after 7 days** (gap 78). An expired photo
disappears from the listing and the owner sees that it has expired.

## Public route protection and limits

`protectListings` checks the origin, limits each client to 60 reads and 30 writes a minute, then runs
the optional bot check (`PRAMAAN_BOT_CHECK_SECRET`). Set `PRAMAAN_SOCIAL_ORIGIN` when a proxy rewrites
the public origin. Each member can also post 20 listings and start 30 photos an hour. Counters are per
process; use a shared limiter for multiple servers. Bodies are bounded, JSON only.

Optional text screening (`PRAMAAN_TEXT_SCREENING=1`) reviews each new or edited title and description.

No new runtime dependency beyond the existing Postgres and Pramaan helpers.

Demo: `/listings` and `/listings/mine`; run `PRAMAAN_FAKE=1 pnpm exec next dev -p 3321`.
