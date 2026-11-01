"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusPill, type PillTone } from "@/components/pramaan/parts";
import { EmptyState, ErrorState, LoadingState, StatusMessage } from "@/components/pramaan/states";
import { ApiError, api, formatMicro, useResource } from "@/lib/pramaan/client";
import type { Account, Person, Role } from "@/lib/pramaan/account";

// Who you are, your organisation's name, the team (owners and admins) and where keys are managed.

const ROLES: Record<Role, { name: string; line: string; tone: PillTone }> = {
  owner: { name: "Owner", line: "Full control, including the team and billing.", tone: "blue" },
  admin: { name: "Admin", line: "Manages the team and settings.", tone: "blue" },
  member: { name: "Member", line: "Runs actions, up to their spending limit.", tone: "grey" },
  viewer: { name: "Viewer", line: "Can look, but can't run anything.", tone: "grey" },
};

const limitWords = (p: Person) => (p.spendLimit ? `Up to ${formatMicro(p.spendLimit.limitMicro)} a ${p.spendLimit.period}` : "No limit");

export function AccountPanel() {
  const r = useResource<Account>("/api/pramaan/account");
  if (r.loading) return <LoadingState label="Loading your account" />;
  if (r.error || !r.data) return <ErrorState error={r.error ?? new ApiError("Something went wrong. Try again.", "internal")} onRetry={r.reload} />;
  const a = r.data;
  const you = ROLES[a.you.role];
  return (
    <div className="space-y-8">
      <section aria-label="You" className="pr-card space-y-2">
        <h2>You</h2>
        <p className="text-sm">{a.you.email ?? "Signed in"}</p>
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <StatusPill tone={you.tone}>{you.name}</StatusPill> {you.line}
        </p>
        <p className="text-sm text-muted-foreground">
          {a.you.mayApprove ? "You can approve requests in the approvals inbox." : "You can't approve requests."} Your spending limit: {a.you.spendLimit ? limitWords(a.you).toLowerCase() : "none"}.
        </p>
      </section>

      <OrganisationName account={a} onSaved={r.reload} />

      <section aria-label="Team" className="space-y-3">
        <h2>Team</h2>
        {a.team ? (
          <ul aria-label="Team members" className="pr-rows">
            {a.team.map((m, i) => (
              <li key={i} className="pr-row">
                <div>
                  <b>{m.email ?? "A team member"}{m.isYou ? " (you)" : ""}</b>
                  <p>{ROLES[m.role].line} {limitWords(m)}.</p>
                </div>
                <StatusPill tone={ROLES[m.role].tone}>{ROLES[m.role].name}</StatusPill>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Only owners and admins see the team">Ask an owner if you need to know who is on it.</EmptyState>
        )}
      </section>

      <section aria-label="Keys and members" className="pr-card space-y-2">
        <h2>Keys and members</h2>
        <p className="text-sm">API keys are made and revoked in the dashboard, and so are invitations, roles and spending limits.</p>
        {a.dashboardUrl && (
          <p className="text-sm">
            <a className="pr-link" href={a.dashboardUrl}>Open the dashboard</a>
          </p>
        )}
      </section>
    </div>
  );
}

function OrganisationName({ account, onSaved }: { account: Account; onSaved: () => void }) {
  const [name, setName] = useState(account.organisationName ?? "");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; tone: "success" | "error" }>();
  return (
    <section aria-label="Organisation" className="pr-card space-y-3">
      <h2>Organisation</h2>
      <p className="text-sm text-muted-foreground">This is the name people outside your team see when you contact them.</p>
      {account.canEditName ? (
        <form
          className="space-y-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setStatus(undefined);
            try {
              const res = await api<{ organisationName: string }>("/api/pramaan/account/organisation", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
              setName(res.organisationName);
              setStatus({ text: "Saved.", tone: "success" });
              onSaved();
            } catch (err) {
              setStatus({ text: err instanceof ApiError ? err.message : "Something went wrong. Try again.", tone: "error" });
            } finally {
              setBusy(false);
            }
          }}
        >
          <Label htmlFor="pramaan-org-name">Organisation name</Label>
          <div className="flex gap-2">
            <Input id="pramaan-org-name" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
            <Button type="submit" disabled={busy || name.trim().length < 2}>Save</Button>
          </div>
          <StatusMessage text={status?.text} tone={status?.tone} />
        </form>
      ) : (
        <p className="text-sm">
          <b>{account.organisationName ?? "No name set yet"}</b>
          <span className="block text-muted-foreground">Only an owner or an admin can change it.</span>
        </p>
      )}
    </section>
  );
}
