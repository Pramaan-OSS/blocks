# Voice call (`voice-call`)

A dialler card for the browser, about 360px wide, with recent calls beside it on wide screens
(stacked below 768px): number display, keypad, calling-from line, a big Call button, an in-call timer with Mute and Hang up, and recent calls with one-click
call back. Licence: MIT.

## Install

```bash
npx shadcn@4.23.0 add https://raw.githubusercontent.com/Pramaan-OSS/blocks/main/public/r/voice-call.json
```

It adds the files below, the shadcn `button`, `input`, `label` and `badge` components, and the
`@pramaan/sdk`, `lucide-react` and `server-only` packages. No other dependency: the phone connection is the SDK's own
`connectBrowserPhone`. Set `PRAMAAN_API_KEY` on the server, `PRAMAAN_VOICE_NUMBER` to one of your numbers
(calls go out from it; `PRAMAAN_VOICE_NUMBERS`, comma separated, gives the "Calling from" picker several), and `APP_URL` if the app sits behind a proxy: **the phone only connects from your
app's exact address**.

## Use

```tsx
import { VoiceCall } from "@/components/pramaan/voice/voice-call";

<VoiceCall approvalsHref="/approvals" />
```

| Prop | Default | What it does |
|---|---|---|
| `approvalsHref` | `/` | where "Open the approvals inbox" goes |
| `pollMs` | 2000 | how often the call log refreshes |
| `standIn` | from the server | force the demo stand-in on or off |

## What it shows

- **Number display and keypad**: a large number with spacing (`+1 415 555 0100`) and a backspace, and a 3 by 4
  keypad with letters. Typing or pasting a number in any layout also works. The number needs its country code.
- **Call**: one big green button. The first call opens the phone (the browser asks for the microphone first; if it
  is blocked the page says how to allow it and does not dial). One click makes one call, even if sent twice.
- **Calling from**: the line the call goes out on; a picker when there are several. Choosing another line opens
  the phone on that number.
- **A call waits for a yes.** Starting an outbound call is irreversible, so with an API key it waits in the
  approvals inbox. The card says so and links to the inbox; the call starts once a member approves.
- **In a call**: who you are calling, the state (Calling, Ringing, Connected), a running timer, Mute (your
  microphone only) and a red Hang up. When it ends the card says so and why (busy, nobody answered, time limit).
  There is no Keypad or Hold control because the API can't do either on a browser call.
  Calls aren't transcribed.
- **Recent calls**: direction, number, time, length and outcome, each with one-click call back (which waits for
  a yes again). The list is this browser's own last 20 calls.
- A session lasts 15 minutes; the next Call opens a new one.
- With `PRAMAAN_FAKE=1` the card shows a small **Demo stand-in** badge: no microphone or sound, real call events.

## Before you go live

A session's reference isn't tied to one person on Pramaan's side. Keep the mapping of person
to session in your own database, and refuse a reference that isn't theirs, in `lib/pramaan/voice.ts`.

## Calls it makes

Server only, from `app/api/pramaan/voice/`, with `PRAMAAN_API_KEY`:

| Action on `POST /api/pramaan/voice` | Pramaan call |
|---|---|
| `open` | `voice.browser-session.create` |
| `call` | `voice.browser-call.start` |
| `end` | `voice.call.end` |
| `close` | `voice.browser-session.close` |
| `GET ?ref=&cursor=` | `voice.browser-session.events` |
| `GET` with no `ref` | none: the lines to call from, from `PRAMAAN_VOICE_NUMBER(S)` |

The page also connects to Pramaan's relay with the session's short-lived credential for sound.
Which provider carries the call is Pramaan's routing; none is named in any screen or error.

## Files

| File | Part |
|---|---|
| `lib/pramaan/voice.ts` | server logic |
| `app/api/pramaan/voice/route.ts` | route handler |
| `components/pramaan/voice/voice-call.tsx` | the dialler card |
| `lib/pramaan/dialler.ts` | number format, timer, recent calls from events |
| `lib/pramaan/browser-phone.ts` | microphone and speakers at 8 kHz |
| `lib/pramaan/*`, `components/pramaan/*` | shared by every block |
