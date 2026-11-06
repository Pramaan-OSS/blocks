# Activity log (`activity`)

Call history and webhook delivery history. Licence: MIT.

Install with `npx shadcn@4.23.0 add https://raw.githubusercontent.com/Pramaan-OSS/blocks/main/public/r/activity.json`.
Set `PRAMAAN_API_KEY` on the server and put `<ActivityLog />` behind your app's sign-in.

The Calls tab lists calls newest first, with action, time and Done or Failed. Filters select an
action, status and inclusive calendar dates. Show more follows the service cursor. Selecting a call
shows its reference and a plain failure explanation. Prices and raw error codes stay off screen.
The API supplies only an error code, so the explanation is local wording, not an upstream message.

The Webhook deliveries tab always appears. It shows event, time, attempt count and response status.
Replay queues a saved payload to its original endpoint. Missing payloads cannot be replayed.
The service keeps payloads for 30 days and limits replays per endpoint across the workspace;
a refusal appears on screen so the person can wait before retrying.

| App route | Service route |
|---|---|
| `GET /api/pramaan/activity` | `GET /v1/calls?capability=&status=&from=&to=&limit=&cursor=` |
| `GET /api/pramaan/activity/{id}` | Looks up the row in paged `GET /v1/calls`; there is no upstream detail route |
| `GET /api/pramaan/activity/deliveries` | `GET /v1/webhook-deliveries` |
| `POST /api/pramaan/activity/deliveries/{id}/replay` | `POST /v1/webhook-deliveries/{id}/replay` |

Calls use `id`, `status: ok|error`, `cost_micro`, `time`, `duration_ms` and nullable `error.code`.
The server maps these to the screen's plain statuses. Calendar dates become ISO timestamps.
No usage fallback is used. Delivery errors remain visible instead of hiding the tab.
