"use client";

import { connectBrowserPhone, type BrowserPhone } from "@pramaan/sdk";
import { ArrowDownLeft, ArrowUpRight, Delete, Mic, MicOff, Phone, PhoneOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/pramaan/parts";
import { ErrorState, LoadingState, StatusMessage } from "@/components/pramaan/states";
import { ApiError, api, useNow, useResource } from "@/lib/pramaan/client";
import { startAudio } from "@/lib/pramaan/browser-phone";
import { KEYS, LETTERS, clock, currentCall, finishedCalls, formatNumber, sanitizeNumber, type RecentCall } from "@/lib/pramaan/dialler";
import { formatDate } from "@/lib/pramaan/plain";
import type { PhoneEvent, PhoneSession } from "@/lib/pramaan/voice";

// A dialler card, about 360px wide. Idle: a number display, a keypad
// and a Call button. In a call: who, the state, a timer, Mute and Hang up. Recent calls sit beside
// it on wide screens and under it on narrow ones, each with one-click call back.
// The browser talks only to Pramaan, with a short-lived credential.

const SAY: Record<string, string> = {
  "call.failed": "The call didn't go through",
  "call.rejected": "The call was declined",
  "call.ended": "Call ended",
  "session.closed": "The phone was closed",
  "session.expired": "The phone timed out",
};
const WHY: Record<string, string> = {
  busy: "The line was busy.",
  no_answer: "Nobody answered.",
  failed: "The call couldn't be completed.",
  rejected: "The other side declined.",
  time_limit: "The call reached its time limit.",
  agent_disconnected: "The phone lost its connection.",
  session_closed: "The phone was closed.",
};

/** How a call ended, in a sentence: "The call didn't go through. The line was busy." */
const ending = (e: PhoneEvent) => `${SAY[e.type] ?? "Call ended"}${e.reason && WHY[e.reason] ? `. ${WHY[e.reason]}` : ""}`;

const HEADLINE = { calling: "Calling", ringing: "Ringing", connected: "Connected" } as const;
const RECENT_KEY = "pramaan-voice-recent";

const round = "flex size-14 items-center justify-center rounded-full border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

interface Lines {
  numbers: string[];
  standIn: boolean;
}

export interface VoiceCallProps {
  /** Where a call waits for a yes. Default: the approvals inbox at "/". */
  approvalsHref?: string;
  /** How often the call events refresh, ms. */
  pollMs?: number;
  /** Overrides the server's answer on whether to use the demo stand-in. */
  standIn?: boolean;
  /** Test seams: the microphone, and the phone connection. */
  getMic?: () => Promise<MediaStream>;
  connectPhone?: typeof connectBrowserPhone;
}

export function VoiceCall({ approvalsHref = "/", pollMs = 2_000, standIn, getMic = () => navigator.mediaDevices.getUserMedia({ audio: true }), connectPhone = connectBrowserPhone }: VoiceCallProps) {
  const lines = useResource<Lines>("/api/pramaan/voice");
  const now = useNow();
  const [session, setSession] = useState<PhoneSession>();
  const [events, setEvents] = useState<PhoneEvent[]>([]);
  const [raw, setRaw] = useState("");
  const [chosen, setChosen] = useState<string>();
  const [muted, setMuted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [waitingFor, setWaitingFor] = useState<string>();
  const [note, setNote] = useState<{ text: string; tone: "info" | "error" | "success" }>();
  const [closed, setClosed] = useState(false);
  const [recents, setRecents] = useState<RecentCall[]>([]);
  const phone = useRef<BrowserPhone>(undefined);
  const audio = useRef<ReturnType<typeof startAudio>>(undefined);
  const cursor = useRef<string>(undefined);
  const dial = useRef<string>(undefined);
  const zeroHeld = useRef(false);
  const zeroTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const merge = useCallback((incoming: PhoneEvent[]) => {
    setEvents((old) => {
      const seen = new Set(old.map((e) => e.id));
      const fresh = incoming.filter((e) => !seen.has(e.id));
      if (fresh.length === 0) return old;
      cursor.current = fresh[fresh.length - 1].id;
      if (fresh.some((e) => e.type.startsWith("session."))) setClosed(true);
      return [...old, ...fresh];
    });
  }, []);

  // Read the session's events while it is open.
  useEffect(() => {
    if (!session || closed) return;
    const t = setInterval(() => {
      const q = new URLSearchParams({ ref: session.ref, ...(cursor.current ? { cursor: cursor.current } : {}) });
      api<{ events: PhoneEvent[] }>(`/api/pramaan/voice?${q}`).then((r) => merge(r.events), () => undefined);
    }, pollMs);
    return () => clearInterval(t);
  }, [session, closed, pollMs, merge]);

  useEffect(() => () => {
    phone.current?.close();
    audio.current?.stop();
  }, []);

  // Recent calls live in this browser: the API has no list of browser calls.
  useEffect(() => {
    try {
      setRecents(JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as RecentCall[]);
    } catch {
      setRecents([]);
    }
  }, []);
  useEffect(() => {
    const done = finishedCalls(events);
    if (done.length === 0) return;
    setRecents((old) => {
      const known = new Set(old.map((r) => r.id));
      const fresh = done.filter((d) => !known.has(d.id)).reverse();
      if (fresh.length === 0) return old;
      const next = [...fresh, ...old].slice(0, 20);
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {
        // Storage full or blocked: the list just won't survive a reload.
      }
      return next;
    });
  }, [events]);

  const call = currentCall(events);
  useEffect(() => {
    if (call.phase !== "idle") {
      setWaitingFor(undefined);
      setNote(undefined);
    }
  }, [call.phase]);

  const post = <T,>(body: object, key?: string) =>
    api<T>("/api/pramaan/voice", { method: "POST", headers: { "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) }, body: JSON.stringify(body) });
  const fail = (err: unknown) => setNote({ text: err instanceof ApiError ? err.message : "Something went wrong. Try again.", tone: "error" });

  const stop = () => {
    phone.current?.close();
    audio.current?.stop();
    phone.current = audio.current = undefined;
  };

  /** Opens a phone session on `from`. The browser asks for the microphone first, so a call can't ring into a page that can't hear it. */
  async function open(from: string): Promise<PhoneSession | undefined> {
    if (session && !closed) void post({ action: "close", ref: session.ref }).catch(() => undefined);
    stop();
    setEvents([]);
    setClosed(false);
    setMuted(false);
    cursor.current = undefined;
    const probe = await post<PhoneSession>({ action: "open", from }, crypto.randomUUID());
    const stand = standIn ?? probe.standIn;
    if (!stand) {
      let stream: MediaStream;
      try {
        stream = await getMic();
      } catch {
        void post({ action: "close", ref: probe.ref }).catch(() => undefined);
        setSession(undefined);
        setNote({ text: "The microphone is blocked. Allow it in your browser's address bar, then try again.", tone: "error" });
        return undefined;
      }
      audio.current = startAudio(stream, (s) => phone.current?.sendAudio(s));
      phone.current = connectPhone({
        connectUrl: probe.connectUrl,
        credential: probe.credential,
        onAudio: (s) => audio.current?.play(s),
        onEvent: (e) => merge([e]),
        onState: (state, reason) => {
          if (state === "closed") {
            setClosed(true);
            setNote({ text: reason === "replaced" ? "The phone was opened in another tab." : "The phone session ended. Press Call to start again.", tone: "error" });
          }
        },
      });
    }
    const s = { ...probe, standIn: stand };
    setSession(s);
    return s;
  }

  /** One click, one call: opens the phone when it isn't open on this line yet, then dials. */
  async function startCall(to: string, from: string) {
    if (busy || to === "") return;
    setBusy(true);
    setNote(undefined);
    try {
      const s = session && !closed && session.number === from ? session : await open(from);
      if (!s) return;
      dial.current = crypto.randomUUID();
      const r = await post<{ status: string }>({ action: "call", ref: s.ref, to }, dial.current);
      if (r.status === "waiting_for_approval") {
        setWaitingFor(to);
        setNote({ text: "Waiting for a yes before the call starts.", tone: "info" });
      }
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function hangUp() {
    if (!call.callRef) return;
    try {
      await post({ action: "end", callRef: call.callRef });
    } catch (err) {
      fail(err);
    }
  }

  if (lines.error && !lines.data) return <ErrorState error={lines.error} onRetry={lines.reload} />;
  if (!lines.data) return <LoadingState label="Loading the phone" />;

  const numbers = lines.data.numbers;
  const from = chosen && numbers.includes(chosen) ? chosen : numbers[0];
  const inCall = call.phase !== "idle";
  const lastEnd = [...events].reverse().find((e) => /^call\.(ended|failed|rejected)$/.test(e.type) || e.type.startsWith("session."));
  const press = (k: string) => setRaw((r) => sanitizeNumber(r + k));

  return (
    <section aria-label="Phone" className="flex w-full flex-col gap-6 md:flex-row md:items-start">
      <div className="relative w-full space-y-4 rounded-3xl border bg-card px-5 pb-5 pt-10 text-card-foreground shadow-sm md:w-[360px] md:shrink-0">
        {(standIn ?? lines.data.standIn) && (
          <span className="absolute right-3 top-3 scale-90">
            <StatusPill tone="amber">Demo stand-in</StatusPill>
          </span>
        )}

        {inCall || waitingFor ? (
          <>
            <div className="space-y-1 pt-2 text-center">
              <p className="text-sm text-muted-foreground">{inCall ? HEADLINE[call.phase as keyof typeof HEADLINE] : "Not started yet"}</p>
              <p className="text-3xl font-medium tabular-nums">{formatNumber(call.to ?? waitingFor ?? "")}</p>
              <p className="h-6 text-lg tabular-nums text-muted-foreground" aria-label={call.phase === "connected" ? "Time on the call" : undefined}>
                {call.phase === "connected" && call.connectedAt && now ? clock((now - call.connectedAt) / 1000) : ""}
              </p>
            </div>
            {inCall ? (
              <div className="flex justify-center gap-6">
                <div className="flex flex-col items-center gap-1">
                  <button
                    type="button"
                    aria-pressed={muted}
                    aria-label={muted ? "Unmute" : "Mute"}
                    className={`${round} ${muted ? "border-foreground bg-foreground text-background" : "bg-muted text-foreground hover:bg-muted/70"}`}
                    onClick={() => {
                      setMuted(!muted);
                      phone.current?.mute(!muted);
                    }}
                  >
                    {muted ? <MicOff aria-hidden className="size-5" /> : <Mic aria-hidden className="size-5" />}
                  </button>
                  <span className="text-xs text-muted-foreground">{muted ? "Unmute" : "Mute"}</span>
                </div>
              </div>
            ) : (
              <div className="space-y-3 text-center">
                <StatusMessage text={note?.text} tone={note?.tone} />
                <a className="pr-link text-sm" href={approvalsHref}>Open the approvals inbox</a>
                <div>
                  <Button variant="ghost" size="sm" onClick={() => { setWaitingFor(undefined); setNote(undefined); }}>Dial a different number</Button>
                </div>
              </div>
            )}
            {inCall && (
              <button
                type="button"
                className="flex h-14 w-full items-center justify-center gap-2 rounded-full bg-red-600 text-base font-semibold text-white transition hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => void hangUp()}
              >
                <PhoneOff aria-hidden className="size-5" />
                Hang up
              </button>
            )}
          </>
        ) : (
          <>
            <div className="relative">
              <label htmlFor="voice-number" className="sr-only">Phone number</label>
              {/* Limit: the box shows the formatted number, so the cursor jumps to the end while typing mid-number. */}
              <input
                id="voice-number"
                inputMode="tel"
                autoComplete="off"
                placeholder="Enter a number"
                value={formatNumber(raw)}
                onChange={(e) => setRaw(sanitizeNumber(e.target.value))}
                onKeyDown={(e) => e.key === "Enter" && void startCall(raw, from)}
                className="h-12 w-full bg-transparent pl-2 pr-10 text-center text-[26px] font-medium tabular-nums outline-none placeholder:text-muted-foreground/50"
              />
              {raw && (
                <button type="button" aria-label="Delete last digit" className="absolute right-0 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setRaw((r) => r.slice(0, -1))}>
                  <Delete aria-hidden className="size-5" />
                </button>
              )}
            </div>
            <p className="-mt-2 min-h-4 text-center text-xs text-muted-foreground">{raw && !raw.startsWith("+") ? "Start with + and the country code, like +1." : ""}</p>

            <div className="grid grid-cols-3 gap-y-2">
              {KEYS.map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-label={k}
                  className="mx-auto flex size-14 flex-col items-center justify-center rounded-full bg-muted text-foreground transition hover:bg-muted/70 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onPointerDown={k === "0" ? () => { zeroHeld.current = false; zeroTimer.current = setTimeout(() => { zeroHeld.current = true; press("+"); }, 500); } : undefined}
                  onPointerUp={k === "0" ? () => clearTimeout(zeroTimer.current) : undefined}
                  onPointerLeave={k === "0" ? () => clearTimeout(zeroTimer.current) : undefined}
                  onClick={() => (k === "0" && zeroHeld.current ? (zeroHeld.current = false) : press(k))}
                >
                  <span className="text-xl font-medium leading-none">{k}</span>
                  <span className="mt-0.5 h-2.5 text-[9px] font-semibold leading-none tracking-[0.15em] text-muted-foreground">{LETTERS[k]}</span>
                </button>
              ))}
            </div>

            <div className="flex items-center justify-between rounded-xl bg-muted/60 px-3 py-2 text-sm">
              <label htmlFor="voice-line" className="text-muted-foreground">Calling from</label>
              {numbers.length > 1 ? (
                <select id="voice-line" className="bg-transparent font-medium tabular-nums outline-none" value={from} onChange={(e) => setChosen(e.target.value)}>
                  {numbers.map((n) => (
                    <option key={n} value={n}>{formatNumber(n)}</option>
                  ))}
                </select>
              ) : (
                <span id="voice-line" className="font-medium tabular-nums">{formatNumber(from)}</span>
              )}
            </div>

            <button
              type="button"
              disabled={busy || raw === ""}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-emerald-600 text-lg font-semibold text-white transition hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
              onClick={() => void startCall(raw, from)}
            >
              <Phone aria-hidden className="size-5" />
              Call
            </button>
            <StatusMessage text={note?.text ?? (lastEnd ? ending(lastEnd) : undefined)} tone={note?.tone} />
          </>
        )}
      </div>

      <div className="min-w-0 space-y-1 rounded-3xl border bg-card px-5 py-5 text-card-foreground shadow-sm md:flex-1">
        <h2 className="text-base">Recent calls</h2>
        {recents.length === 0 ? (
          <p className="text-sm text-muted-foreground">Calls you make from here show up in this list.</p>
        ) : (
          <ul aria-label="Recent calls" className="divide-y">
            {recents.map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-2">
                <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  {r.direction === "out" ? <ArrowUpRight className="size-4" /> : <ArrowDownLeft className="size-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium tabular-nums">{formatNumber(r.number)}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {r.direction === "out" ? "Outgoing" : "Incoming"} · {formatDate(r.at)} · {r.seconds === undefined ? "No talk time" : clock(r.seconds)} ·{" "}
                    <span className={r.missed ? "text-destructive" : undefined}>{r.outcome}</span>
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={`Call back ${formatNumber(r.number)}`}
                  disabled={busy || inCall || Boolean(waitingFor)}
                  className="flex size-9 shrink-0 items-center justify-center rounded-full text-emerald-600 hover:bg-emerald-600/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
                  onClick={() => void startCall(r.number, from)}
                >
                  <Phone aria-hidden className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
