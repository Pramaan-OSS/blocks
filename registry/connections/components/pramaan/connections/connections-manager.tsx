"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmAction } from "@/components/pramaan/confirm-action";
import { type PillTone, StatusPill } from "@/components/pramaan/parts";
import { EmptyState, ErrorState, LoadingState, StatusMessage, type StatusTone } from "@/components/pramaan/states";
import { ApiError, announceChange, api, useResource } from "@/lib/pramaan/client";
import { formatDate, humanize } from "@/lib/pramaan/plain";
import type { Connection, ConnectionList, ConnectionStatus } from "@/lib/pramaan/connections";
import { AppIcon } from "./app-icon";
import type { ReactNode } from "react";

export interface AppEntry {
  /** The app id Pramaan uses, lowercase: gmail, googlecalendar, github. */
  readonly id: string;
  readonly label: string;
  readonly note?: string;
  /** Your own logo; apps without one get the built-in logo or a lettered tile. */
  readonly icon?: ReactNode;
  readonly logo_url?: string | null;
}

/** The apps offered with a Connect button. Pass your own `apps` to change them. */
export const DEFAULT_APPS: readonly AppEntry[] = [
  { id: "gmail", label: "Gmail", note: "Connects your own Gmail." },
  { id: "outlook", label: "Outlook", note: "Connects your own Outlook." },
  { id: "googlecalendar", label: "Google Calendar", note: "Connects your own calendar." },
  { id: "github", label: "GitHub" },
];

const STATUS: Record<ConnectionStatus | "none", { text: string; tone: PillTone }> = {
  connected: { text: "Connected", tone: "green" },
  needs_reconnect: { text: "Needs reconnect", tone: "amber" },
  pending: { text: "Waiting for sign-in", tone: "blue" },
  revoked: { text: "Revoked", tone: "grey" },
  none: { text: "Not connected", tone: "grey" },
};

const ACCESS: Record<NonNullable<Connection["access"]>, string> = {
  read: "Can read",
  "read-write": "Can read and change",
  full: "Full access",
  limited: "Limited: some actions will fail",
};

const ACCOUNT_STATUS: Record<string, string> = { connected: "Connected", pending: "Pending", restricted: "Restricted", disconnected: "Disconnected" };

const toBrowser = (url: string) => window.location.assign(url);

/**
 * Every connected account in one list: connect, check, reconnect, disconnect.
 *
 * - `apps`: what to offer (default Gmail, Outlook, Google Calendar, GitHub).
 * - `returnPath`: the page people land on after signing in (default /connections/return, see `ConnectionReturn`).
 * - `approvalsHref`: where your approvals inbox is; removing a connection waits there.
 * - `navigate`: how to open the sign-in link (default: this tab).
 */
export function ConnectionsManager({
  apps = DEFAULT_APPS,
  returnPath = "/connections/return",
  approvalsHref = "/",
  pollMs,
  navigate = toBrowser,
}: {
  apps?: readonly AppEntry[];
  returnPath?: string;
  approvalsHref?: string;
  pollMs?: number;
  navigate?: (url: string) => void;
}) {
  const list = useResource<ConnectionList>("/api/pramaan/connections", pollMs);
  const [note, setNote] = useState<{ text: string; tone: StatusTone }>();
  const [waiting, setWaiting] = useState(false);
  const say = (text: string, tone: StatusTone = "info") => setNote({ text, tone });
  const fail = (e: unknown) => say(e instanceof ApiError ? e.message : "Something went wrong. Try again.", "error");
  const post = <T,>(url: string, body: unknown) => api<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  if (list.error && !list.data) return <ErrorState error={list.error} onRetry={list.reload} />;
  if (!list.data) return <LoadingState label="Loading connections" />;

  const byApp = new Map(list.data.connections.map((c) => [c.app, c]));
  const rows: { app: AppEntry; conn?: Connection }[] = [
    ...apps.map((app) => ({ app, conn: byApp.get(app.id) })),
    ...list.data.connections.filter((c) => !apps.some((a) => a.id === c.app)).map((c) => ({ app: { id: c.app, label: humanize(c.app) }, conn: c })),
  ];

  async function connect(app: AppEntry) {
    say(`Opening the sign-in for ${app.label}…`);
    try {
      const { connectUrl } = await post<{ connectUrl: string }>("/api/pramaan/connections/start", { app: app.id, returnPath });
      navigate(connectUrl);
    } catch (e) {
      fail(e);
    }
  }

  async function check(app: AppEntry, conn: Connection) {
    try {
      const c = await api<{ status: ConnectionStatus; name?: string }>(`/api/pramaan/connections/${encodeURIComponent(conn.connectionId!)}`);
      say(c.status === "connected" ? `${app.label} is connected${c.name ? ` as ${c.name}` : ""}.` : `${app.label}: ${STATUS[c.status].text.toLowerCase()}.`, c.status === "connected" ? "success" : "info");
      list.reload();
    } catch (e) {
      fail(e);
    }
  }

  async function disconnect(app: AppEntry) {
    try {
      await post("/api/pramaan/connections/revoke", { app: app.id });
      say(`${app.label} is disconnected and its access is revoked.`, "success");
      list.reload();
      announceChange();
    } catch (e) {
      fail(e);
    }
  }

  async function remove(app: AppEntry, conn: Connection) {
    try {
      const res = await post<{ status: string }>("/api/pramaan/connections/delete", { connectionId: conn.connectionId });
      if (res.status === "waiting_for_approval") {
        setWaiting(true);
        say(`Removing ${app.label} was sent for approval. Decide it in the approvals inbox; the saved credentials are deleted once it is approved.`);
      } else say(`${app.label} was removed.`, "success");
      list.reload();
      announceChange();
    } catch (e) {
      fail(e);
    }
  }

  return (
    <div className="space-y-8">
      <section aria-label="Connected apps" className="space-y-3">
        <StatusMessage text={note?.text} tone={note?.tone} />
        {waiting && (
          <a className="text-sm underline" href={approvalsHref}>
            Open the approvals inbox
          </a>
        )}
        <ul className="pr-rows">
          {rows.map(({ app, conn }) => {
            const status = STATUS[conn?.status ?? "none"];
            const connected = conn?.status === "connected";
            const stale = conn?.status === "needs_reconnect";
            return (
              <li key={app.id} aria-label={app.label} className="pr-row">
                <div className="pr-row-main flex items-center gap-3">
                <AppIcon id={app.id} label={app.label} icon={app.icon} logoUrl={conn?.logo_url ?? app.logo_url} />
                <div>
                  <p className="flex items-center gap-2 font-semibold">
                    {app.label} <StatusPill tone={status.tone}>{status.text}</StatusPill>
                  </p>
                  <p className="pr-row-sub">
                    {conn?.name ? `${conn.name} · ` : ""}
                    {conn?.access ? `${ACCESS[conn.access]}` : conn ? "" : app.note ?? ""}
                    {conn?.connectedAt && conn.status !== "revoked" ? ` · connected ${formatDate(conn.connectedAt, { time: false })}` : ""}
                  </p>
                </div>
                </div>
                <div className="pr-row-side">
                  {(!conn || conn.status === "revoked") && <Button onClick={() => connect(app)}>{conn ? "Connect again" : "Connect"}</Button>}
                  {stale && <Button onClick={() => connect(app)}>Reconnect</Button>}
                  {conn?.status === "pending" && <Button variant="outline" onClick={() => connect(app)}>Continue sign-in</Button>}
                  {conn?.connectionId && (connected || stale || conn.status === "pending") && (
                    <Button variant="outline" onClick={() => check(app, conn)}>
                      Check
                    </Button>
                  )}
                  {(connected || stale) && (
                    <ConfirmAction
                      label="Disconnect"
                      title={`Disconnect ${app.label}?`}
                      description="Its access is revoked, and anything in your app that uses this account stops working until it is connected again."
                      confirmLabel="Disconnect"
                      variant="destructive"
                      onConfirm={() => disconnect(app)}
                    />
                  )}
                  {conn?.connectionId && (conn.status === "needs_reconnect" || conn.status === "revoked") && (
                    <ConfirmAction
                      label="Remove"
                      title={`Remove ${app.label} for good?`}
                      description="This deletes the connection and its saved credentials. It needs approval, so the request goes to the approvals inbox first."
                      confirmLabel="Remove"
                      variant="destructive"
                      onConfirm={() => remove(app, conn)}
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-label="Workspace accounts" className="space-y-3">
        <h2>Workspace accounts</h2>
        <p className="text-sm text-muted-foreground">The accounts your own workspace sends and posts from.</p>
        {list.data.accounts.length === 0 ? (
          <EmptyState title="No workspace accounts">Accounts you connect for your workspace show here.</EmptyState>
        ) : (
          <Table aria-label="Workspace accounts">
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.accounts.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.label ?? "Account"}</TableCell>
                  <TableCell>{a.family ? humanize(a.family) : ""}</TableCell>
                  <TableCell>
                    <StatusPill tone={a.status === "connected" ? "green" : a.status === "pending" ? "blue" : "grey"}>{ACCOUNT_STATUS[a.status] ?? humanize(a.status)}</StatusPill>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}

/**
 * The page people land on after the hosted sign-in (`app` comes from `?app=` unless you pass it). It asks Pramaan for the connection's status and
 * waits a few seconds for it to turn connected, then says where things stand.
 */
export function ConnectionReturn({
  app: appProp,
  appLabel,
  backHref = "/connections",
  attempts = 5,
  everyMs = 1_500,
}: {
  app?: string;
  appLabel?: string;
  backHref?: string;
  attempts?: number;
  everyMs?: number;
}) {
  const [phase, setPhase] = useState<"checking" | "connected" | "not_yet" | "error">("checking");
  const [error, setError] = useState<ApiError>();
  const [round, setRound] = useState(0);
  // `?app=` is read in the browser, so the page can be prerendered.
  const [fromUrl, setFromUrl] = useState<string | null>();
  useEffect(() => setFromUrl(new URLSearchParams(location.search).get("app")), []);
  const app = appProp ?? fromUrl ?? undefined;
  const label = appLabel ?? DEFAULT_APPS.find((a) => a.id === app)?.label ?? app ?? "the app";

  useEffect(() => {
    if (!app) return;
    let live = true;
    setPhase("checking");
    (async () => {
      for (let i = 0; i < attempts && live; i++) {
        try {
          const { connections } = await api<ConnectionList>(`/api/pramaan/connections?app=${encodeURIComponent(app)}`);
          if (!live) return;
          if (connections.some((c) => c.status === "connected")) return setPhase("connected");
        } catch (e) {
          if (!live) return;
          setError(e as ApiError);
          return setPhase("error");
        }
        if (i < attempts - 1) await new Promise((r) => setTimeout(r, everyMs));
      }
      if (live) setPhase("not_yet");
    })();
    return () => {
      live = false;
    };
  }, [app, attempts, everyMs, round]);

  if (!appProp && fromUrl === undefined) return <LoadingState label="Loading" />;
  if (!app) return <EmptyState title="Nothing to check">Open this page from a sign-in.</EmptyState>;
  return (
    <div className="space-y-4">
      {phase === "checking" && <LoadingState label={`Checking your ${label} connection`} />}
      {phase === "connected" && <StatusMessage tone="success" text={`${label} is connected.`} />}
      {phase === "not_yet" && (
        <div className="space-y-3">
          <StatusMessage text={`${label} isn't connected yet. If you just finished signing in, check again in a moment.`} />
          <Button variant="outline" onClick={() => setRound(round + 1)}>
            Check again
          </Button>
        </div>
      )}
      {phase === "error" && error && <ErrorState error={error} onRetry={() => setRound(round + 1)} />}
      <a className="text-sm underline" href={backHref}>
        Back to your connections
      </a>
    </div>
  );
}
