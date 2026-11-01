"use client";

import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NeedsConnection, ErrorState, LoadingState, StatusMessage, EmptyState } from "@/components/pramaan/states";
import { ApiError, api, useResource } from "@/lib/pramaan/client";
import type { Availability, Booked } from "@/lib/pramaan/booking";

// A visitor picks an open time on the owner's calendar and books it. Only open times are shown.

export interface BookingPickerProps {
  /** Where "needs connection" sends the owner: the connections block. */
  connectionsHref?: string;
  /** How many days ahead to show, 1 to 31. */
  days?: number;
  /** Supply a fresh token from your site's bot-check widget when enabled on the server. */
  getBotCheckToken?: () => Promise<string>;
}

type Slot = { start: string; end: string };

export function BookingPicker({ connectionsHref = "/connections", days, getBotCheckToken }: BookingPickerProps) {
  const url = `/api/pramaan/booking${days ? `?days=${days}` : ""}`;
  const { data, error, loading, reload } = useResource<Availability>(url);
  const [day, setDay] = useState<string>();
  const [slot, setSlot] = useState<Slot>();
  const [form, setForm] = useState({ name: "", email: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; tone: "error" }>();
  const [done, setDone] = useState<Booked>();
  const key = useRef<string>(undefined);

  const zone = data?.state === "ready" ? data.timezone : "UTC";
  const dayOf = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: zone });
  const dayLabel = (iso: string) => new Date(iso).toLocaleDateString("en", { timeZone: zone, weekday: "short", day: "numeric", month: "short" });
  const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString("en", { timeZone: zone, hour: "numeric", minute: "2-digit" });

  const byDay = useMemo(() => {
    const out = new Map<string, Slot[]>();
    if (data?.state === "ready") for (const s of data.slots) out.set(dayOf(s.start), [...(out.get(dayOf(s.start)) ?? []), s]);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (loading) return <LoadingState label="Loading open times" />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return null;
  if (data.state === "needs_connection")
    return (
      <div className="space-y-3">
        <NeedsConnection
          message={data.reason === "needs_reconnect" ? "The calendar needs to be connected again." : "No calendar is connected yet."}
          next="Connect your calendar so people can book the times you have free."
        />
        <a className="pr-link" href={connectionsHref}>Go to connections</a>
      </div>
    );

  if (done)
    return (
      <section aria-label="Booking" className="pr-card space-y-2">
        <h2>{done.status === "booked" ? "You're booked" : "Request sent"}</h2>
        <p className="text-sm">{dayLabel(done.start)} at {timeLabel(done.start)} ({zone}).</p>
        <p className="text-sm text-muted-foreground">
          {done.status === "booked" ? "An invitation is on its way to your email." : "Your request is waiting for a yes. You'll get an invitation by email once it's confirmed. If you don't hear back, the time wasn't confirmed."}
        </p>
      </section>
    );

  const days_ = [...byDay.keys()];
  if (days_.length === 0) return <EmptyState title="No open times">There's nothing free in the next few days. Check back later.</EmptyState>;
  const current = day && byDay.has(day) ? day : days_[0];

  async function submit() {
    if (!slot) return;
    setBusy(true);
    setNote(undefined);
    key.current ??= crypto.randomUUID();
    try {
      const botCheckToken = await getBotCheckToken?.();
      setDone(await api<Booked>("/api/pramaan/booking", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key.current }, body: JSON.stringify({ start: slot.start, ...form, botCheckToken }) }));
    } catch (err) {
      key.current = undefined;
      setNote({ text: err instanceof ApiError ? err.message : "Something went wrong. Try again.", tone: "error" });
      if (err instanceof ApiError && err.status === 409) {
        setSlot(undefined);
        reload();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Booking" className="pr-card space-y-4">
      <div className="space-y-1">
        <h2>{data.title}, {data.slotMinutes} minutes</h2>
        <p className="text-sm text-muted-foreground">Times are shown in {zone}.</p>
      </div>
      <div role="group" aria-label="Day" className="flex flex-wrap gap-2">
        {days_.map((d) => (
          <Button key={d} type="button" size="sm" variant={d === current ? "default" : "outline"} aria-pressed={d === current} onClick={() => { setDay(d); setSlot(undefined); }}>
            {dayLabel(byDay.get(d)![0].start)}
          </Button>
        ))}
      </div>
      <div role="group" aria-label="Time" className="flex flex-wrap gap-2">
        {byDay.get(current)!.map((s) => (
          <Button key={s.start} type="button" size="sm" variant={slot?.start === s.start ? "default" : "outline"} aria-pressed={slot?.start === s.start} onClick={() => { setSlot(s); key.current = undefined; }}>
            {timeLabel(s.start)}
          </Button>
        ))}
      </div>
      {slot && (
        <form noValidate className="space-y-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <p className="text-sm font-medium">{dayLabel(slot.start)} at {timeLabel(slot.start)}</p>
          <div className="space-y-1">
            <Label htmlFor="booking-name">Your name</Label>
            <Input id="booking-name" autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="booking-email">Your email</Label>
            <Input id="booking-email" type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="booking-notes">Anything we should know? (optional)</Label>
            <Input id="booking-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          <Button type="submit" disabled={busy}>Book this time</Button>
        </form>
      )}
      <StatusMessage text={note?.text} tone={note?.tone} />
    </section>
  );
}
