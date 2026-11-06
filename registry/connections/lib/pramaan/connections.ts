import "server-only";
import { PramaanError } from "@pramaan/sdk";
import { capability, pramaan, signedOut } from "@/lib/pramaan/server";
import { currentEndUserRef } from "@/lib/pramaan/session";

// Server half of the connections manager. Your end users connect their own apps (Gmail, Outlook,
// a calendar) through Pramaan's hosted sign-in; this lists, starts, checks, revokes and deletes
// those connections with the apps.connection* superpowers, and lists your own accounts.

export type ConnectionStatus = "connected" | "needs_reconnect" | "pending" | "revoked";

export interface Connection {
  readonly logo_url?: string | null;
  readonly app: string;
  readonly status: ConnectionStatus;
  /** The API's own state: active, pending, failed, expired, disabled or revoked. */
  readonly state: string;
  readonly connectedAt?: string;
  readonly access?: "read" | "read-write" | "full" | "limited";
  /** From the detailed list: needed to check or delete one connection. */
  readonly connectionId?: string;
  /** The connected account's label; may contain personal text. */
  readonly name?: string;
}

export interface WorkspaceAccount {
  readonly id: string;
  readonly label?: string;
  readonly family?: string;
  readonly origin: "own" | "platform";
  readonly status: "connected" | "pending" | "restricted" | "disconnected";
  readonly created_at: string;
}

export interface ConnectionList {
  readonly connections: Connection[];
  readonly accounts: WorkspaceAccount[];
}

interface ListRow {
  logo_url?: string | null;
  app: string;
  status: string;
  connectedAt?: string;
  access?: Connection["access"];
}
interface DetailRow {
  connectionId: string;
  app: string;
  status: string;
  name?: string;
  connectedAt?: string;
}

const bad = (message: string, status = 400) => new PramaanError("invalid_request", message, { status });

const APP = /^[a-z0-9_-]{1,64}$/;
const CONNECTION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

const statusOf = (state: string): ConnectionStatus =>
  state === "active" ? "connected" : state === "pending" ? "pending" : state === "revoked" ? "revoked" : "needs_reconnect";

/** Your own reference for the signed-in person (see lib/pramaan/session.ts). Never an email or a name. */
async function endUser(request: Request): Promise<string> {
  const ref = await currentEndUserRef(request);
  if (!ref) throw signedOut("Your connected apps show here once you're signed in.");
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(ref))
    throw bad("Your sign-in couldn't be read. Ask whoever runs this app to check its setup.", 500);
  return ref;
}

export async function listConnections(request: Request, app?: string): Promise<ConnectionList> {
  const endUserRef = await endUser(request);
  if (app !== undefined && !APP.test(app)) throw bad("That app id isn't valid.");
  const filter = app ? { app } : {};
  const [list, detailed, accounts] = await Promise.all([
    capability<{ results: ListRow[] }>("apps.connections.list", { endUserRef, ...filter }),
    capability<{ results: DetailRow[] }>("apps.connections.list-detailed", { endUserRef, ...filter }),
    pramaan<{ results: WorkspaceAccount[] }>("/v1/accounts"),
  ]);
  const connections = list.results.map((row): Connection => {
    const detail = detailed.results.find((d) => d.app === row.app);
    return {
      app: row.app,
      logo_url: row.logo_url,
      state: row.status,
      status: statusOf(row.status),
      ...(row.connectedAt ? { connectedAt: row.connectedAt } : {}),
      ...(row.access ? { access: row.access } : {}),
      ...(detail ? { connectionId: detail.connectionId, ...(detail.name ? { name: detail.name } : {}) } : {}),
    };
  });
  return { connections, accounts: accounts.results };
}

/** Re-reads one connection (apps.connection.get): its state, account label and dates. */
export async function checkConnection(request: Request, connectionId: string) {
  const endUserRef = await endUser(request);
  if (!CONNECTION_ID.test(connectionId)) throw bad("That connection id isn't valid.");
  const c = await capability<DetailRow>("apps.connection.get", { endUserRef, connectionId });
  return { ...c, status: statusOf(c.status), state: c.status };
}

/**
 * Starts connecting the person to an app and returns the hosted sign-in link. After signing in they
 * land on `returnPath` (default /connections/return) on this app, with `?app=` so the page can check.
 */
export async function startConnection(request: Request, body: { app?: unknown; returnPath?: unknown }) {
  const endUserRef = await endUser(request);
  if (typeof body.app !== "string" || !APP.test(body.app)) throw bad("Choose an app to connect.");
  const path = body.returnPath ?? "/connections/return";
  if (typeof path !== "string" || !/^\/[A-Za-z0-9/_-]*$/.test(path)) throw bad("The return page must be a path on this app, like /connections/return.");
  const origin = process.env.PRAMAAN_APP_URL?.replace(/\/+$/, "") || new URL(request.url).origin;
  const redirectUrl = `${origin}${path}?app=${body.app}`;
  return capability<{ connectUrl: string; expiresAt?: string }>("apps.connection.start", { endUserRef, app: body.app, redirectUrl });
}

/** Disconnects the person from an app and revokes its access. */
export async function revokeConnection(request: Request, body: { app?: unknown }) {
  const endUserRef = await endUser(request);
  if (typeof body.app !== "string" || !APP.test(body.app)) throw bad("Choose an app to disconnect.");
  const res = await capability<{ revoked?: number; status?: string }>("apps.connection.revoke", { endUserRef, app: body.app });
  return res.status === "running" ? { status: "waiting_for_approval" as const } : { status: "revoked" as const, revoked: res.revoked ?? 0 };
}

/** Deletes one connection and its saved credentials. This needs a member's approval: 202 means it waits in the inbox. */
export async function deleteConnection(request: Request, body: { connectionId?: unknown }) {
  const endUserRef = await endUser(request);
  if (typeof body.connectionId !== "string" || !CONNECTION_ID.test(body.connectionId)) throw bad("Choose a connection to remove.");
  const res = await capability<{ deleted?: boolean; status?: string }>("apps.connection.delete", { endUserRef, connectionId: body.connectionId, confirm: true });
  return res.status === "running" ? { status: "waiting_for_approval" as const } : { status: "deleted" as const };
}
