# Consent and opt-out (`consent`)

Honour STOP and consent. Licence: MIT.

Install with `npx shadcn@4.23.0 add https://raw.githubusercontent.com/Pramaan-OSS/blocks/main/public/r/consent.json`.
Set `PRAMAAN_API_KEY` on the server and connect `currentMemberId` to your trusted sign-in.

`<ConsentManager />` lists masked addresses, checks contacts and adds opt-outs. Search is a
case-insensitive match on the shortened address, performed by `messaging.opt-outs.list`.
Channel and source filters and removal history use the same capability. Show more follows its cursor.
The service keeps `createdBy`, `removedBy` and `removedAt`; screens indicate recorded actors without
printing their identifiers. There is no console audit substitute.

Removal sends `optOutId` and `confirm: true` to `messaging.opt-out.remove`. A 202 remains waiting
for approval, with the opt-out still active. Only entries added by the project can be removed;
a recipient's own STOP or unsubscribe stays. No whole-address confirmation is needed.

`<ConsentBadge address={contact.phone} channel="sms" />` checks whether contact is blocked.

The public page takes the original signed recipient link from a message:
`<UnsubscribePage link={signedRecipientLink} />`. In the demo, `/stop?link=` accepts that encoded
link. Without a link the page explains how to find it; there is no free-form address input.
The server accepts only `/unsubscribe/{token}` on `PRAMAAN_BASE_URL`'s origin and posts to that
public route without an API key or a substituted address. It refuses redirects. A GET never
unsubscribes anyone. Use a member-bound key for actions whose actor must be a member.

| App route | Service call |
|---|---|
| `GET /api/pramaan/consent?query=&channel=&source=&removed=&cursor=` | `messaging.opt-outs.list` |
| `GET /api/pramaan/consent/check?address=&channel=` | `messaging.opt-out.check` |
| `POST /api/pramaan/consent` | `messaging.opt-out.add` |
| `POST /api/pramaan/consent/remove` | `messaging.opt-out.remove` |
| `POST /api/pramaan/consent/unsubscribe` | `POST /unsubscribe/{token}` from the signed link |

The public write guard remains in front of unsubscribe. Configure trusted proxy headers and a
shared rate-limit store when running multiple server instances.
