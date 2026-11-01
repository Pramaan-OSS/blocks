"use client";

import { useEffect, useRef, useState } from "react";
import { StatusPill } from "@/components/pramaan/parts";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, ErrorState, LoadingState } from "@/components/pramaan/states";
import { formatMicro, useResource } from "@/lib/pramaan/client";
import { actionName, formatDay, humanize } from "@/lib/pramaan/plain";
import type { CustomerCredits, Usage, UsageRow, WalletSummary } from "@/lib/pramaan/wallet";

const linkButton = "pr-btn pr-btn-primary";

/** Opens the page where credit is added. */
export function TopUpButton({ href, label = "Add credit" }: { href: string; label?: string }) {
  return (
    <a className={linkButton} href={href} target="_blank" rel="noopener noreferrer">
      {label}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

/**
 * The balance, credit set aside for running requests, today's spend, a low-balance warning and the
 * top-up button. `lowBalanceMicro`: warn below this (default $5.00). Open the page with `?topup=1`
 * (a refusal for low credit can link there) to point at the button.
 */
export function WalletCard({ lowBalanceMicro = 5_000_000, pollMs }: { lowBalanceMicro?: number; pollMs?: number }) {
  const w = useResource<WalletSummary>("/api/pramaan/wallet", pollMs);
  const button = useRef<HTMLDivElement>(null);
  const [asked, setAsked] = useState(false);
  useEffect(() => {
    if (new URLSearchParams(location.search).has("topup")) setAsked(true);
  }, []);
  useEffect(() => {
    if (asked && w.data) button.current?.querySelector<HTMLElement>("a")?.focus();
  }, [asked, w.data]);

  if (w.error && !w.data) return <ErrorState error={w.error} onRetry={w.reload} />;
  if (!w.data) return <LoadingState label="Loading your balance" />;
  const { balance: b, topUpUrl } = w.data;
  const low = b.balance_micro < lowBalanceMicro;
  return (
    <section aria-label="Balance" className="pr-card space-y-3">
      {asked && <p role="status" className="rounded-md bg-muted p-3 text-sm">That request needs more credit than you have. Add credit, then try it again.</p>}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">Balance</p>
          <p className="pr-num" aria-label={`Balance ${formatMicro(b.balance_micro)}`}>
            {formatMicro(b.balance_micro)}
          </p>
        </div>
        <div ref={button}>
          <TopUpButton href={topUpUrl} />
        </div>
      </div>
      {low && (
        <p role="alert" className="rounded-md border border-destructive/50 p-3 text-sm text-destructive">
          {b.balance_micro <= 0 ? "Your balance is empty." : `Your balance is low (${formatMicro(b.balance_micro)}).`} Add credit before your next run.
        </p>
      )}
      <dl className="grid grid-cols-1 gap-x-8 gap-y-1 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">Set aside for running requests</dt>
          <dd>{formatMicro(b.held_micro)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Spent today</dt>
          <dd>{formatMicro(b.today_spend_micro)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Daily cap</dt>
          <dd>{b.daily_cap_micro === null ? "None" : formatMicro(b.daily_cap_micro)}</dd>
        </div>
      </dl>
    </section>
  );
}

const DAY = 86_400_000;
const RANGES = [7, 30] as const;

/** Every day from `from` to `to`, so a day with no spend still shows. */
function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(from); t <= Date.parse(to); t += DAY) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

function sumBy<K extends string>(rows: readonly UsageRow[], key: (r: UsageRow) => K) {
  const m = new Map<K, { calls: number; spend: number }>();
  for (const r of rows) {
    const cur = m.get(key(r)) ?? { calls: 0, spend: 0 };
    m.set(key(r), { calls: cur.calls + r.calls, spend: cur.spend + r.spend_micro });
  }
  return m;
}

/** Spend over time and by what it was spent on, and the latest activity with its cost. */
export function UsagePanel() {
  const [days, setDays] = useState<(typeof RANGES)[number]>(7);
  const u = useResource<Usage>(`/api/pramaan/wallet/usage?days=${days}`);
  return (
    <section aria-label="Usage" className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h2>Usage</h2>
        <div role="group" aria-label="Time range" className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={days === r}
              onClick={() => setDays(r)}
              className="pr-btn pr-btn-sm"
            >
              Last {r} days
            </button>
          ))}
        </div>
      </div>
      {u.error && !u.data ? (
        <ErrorState error={u.error} onRetry={u.reload} />
      ) : !u.data ? (
        <LoadingState label="Loading usage" />
      ) : u.data.results.length === 0 ? (
        <EmptyState title="No usage in this period">Spend shows here once your app makes calls.</EmptyState>
      ) : (
        <UsageBody usage={u.data} />
      )}
    </section>
  );
}

function UsageBody({ usage }: { usage: Usage }) {
  const perDay = sumBy(usage.results, (r) => r.day);
  const perCap = [...sumBy(usage.results, (r) => r.capability)].sort((a, b) => b[1].spend - a[1].spend);
  const total = perCap.reduce((n, [, v]) => n + v.spend, 0);
  const days = daysBetween(usage.from, usage.to);
  const peak = Math.max(1, ...days.map((d) => perDay.get(d)?.spend ?? 0));
  const latest = [...usage.results].sort((a, b) => b.day.localeCompare(a.day) || b.spend_micro - a.spend_micro).slice(0, 8);
  return (
    <>
      <p className="text-sm">
        Spent <strong>{formatMicro(total)}</strong> on {perCap.reduce((n, [, v]) => n + v.calls, 0)} calls.
      </p>
      <ol aria-label="Spend by day" className="flex h-40 items-end gap-1">
        {days.map((d, i) => {
          const spend = perDay.get(d)?.spend ?? 0;
          // Every bar is a stop for the keyboard; its amount shows on hover and on focus.
          const showLabel = days.length <= 7 || (days.length - 1 - i) % 5 === 0;
          return (
            <li key={d} tabIndex={0} className="group relative flex h-full flex-1 flex-col justify-end rounded outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <div className="w-full rounded-t bg-primary group-hover:opacity-80 group-focus-visible:opacity-80" style={{ height: `calc(${(spend / peak) * 100}% - 18px)`, minHeight: spend > 0 ? 2 : 0 }} />
              <span aria-hidden className="h-[18px] whitespace-nowrap text-center text-[11px] leading-[18px] text-muted-foreground">
                {showLabel ? formatDay(d, false) : ""}
              </span>
              <span aria-hidden className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-foreground px-2 py-1 text-xs text-background group-hover:block group-focus-visible:block">
                {formatDay(d)}: {formatMicro(spend)}
              </span>
              <span className="sr-only">
                {formatDay(d)}: {formatMicro(spend)}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-2">
          <h3>What it was spent on</h3>
          <Table aria-label="Spend by action">
            <TableHeader>
              <TableRow>
                <TableHead>What ran</TableHead>
                <TableHead className="text-right">Calls</TableHead>
                <TableHead className="text-right">Spend</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {perCap.map(([id, v]) => (
                <TableRow key={id}>
                  <TableCell>{actionName(id)}</TableCell>
                  <TableCell className="text-right">{v.calls}</TableCell>
                  <TableCell className="text-right">{formatMicro(v.spend)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="space-y-2">
          <h3>Latest activity</h3>
          <Table aria-label="Latest activity">
            <TableHeader>
              <TableRow>
                <TableHead>Day</TableHead>
                <TableHead>What ran</TableHead>
                <TableHead className="text-right">Calls</TableHead>
                <TableHead className="text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {latest.map((r) => (
                <TableRow key={r.day + r.capability}>
                  <TableCell>{formatDay(r.day)}</TableCell>
                  <TableCell>{actionName(r.capability)}</TableCell>
                  <TableCell className="text-right">{r.calls}</TableCell>
                  <TableCell className="text-right">{formatMicro(r.spend_micro)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </>
  );
}

/** The prepaid credit of one of your own customers (billing.credits.balance), for apps that bill their users. */
export function CustomerCreditsCard({ customerId }: { customerId: string }) {
  const c = useResource<CustomerCredits>(`/api/pramaan/wallet/customers/${encodeURIComponent(customerId)}`);
  if (c.error && !c.data) return <ErrorState error={c.error} onRetry={c.reload} />;
  if (!c.data) return <LoadingState label="Loading credit" />;
  if (c.data.balances.length === 0) return <EmptyState title="No prepaid credit">This customer has none.</EmptyState>;
  return (
    <ul aria-label="Customer credit" className="space-y-1 text-sm">
      {c.data.balances.map((b, i) => (
        <li key={i} className="flex items-center gap-2">
          <StatusPill>{b.kind === "money" ? "Money" : humanize(b.kind)}</StatusPill>
          <strong>{new Intl.NumberFormat("en-US", { style: "currency", currency: b.available.currency }).format(b.available.amount / 100)}</strong> available
        </li>
      ))}
    </ul>
  );
}

/** Balance, top-up, usage and latest activity on one page. */
export function Wallet(props: { lowBalanceMicro?: number; pollMs?: number }) {
  return (
    <div className="space-y-8">
      <WalletCard {...props} />
      <UsagePanel />
    </div>
  );
}
