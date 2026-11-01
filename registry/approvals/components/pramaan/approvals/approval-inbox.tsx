"use client";

import { useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, ErrorState, LoadingState } from "@/components/pramaan/states";
import { upTo, useNow, useResource } from "@/lib/pramaan/client";
import { actionName, formatDate, requesterLabel } from "@/lib/pramaan/plain";
import type { ApprovalList } from "@/lib/pramaan/approvals";
import { ApprovalDetail, StateBadge } from "./approval-detail";
import { type HistoryEntry, readHistory } from "./history";

/**
 * Everything waiting for a yes: pending list, detail with exact inputs, Approve / Decline, and
 * a history of this app's decisions. Members who may not approve see it read-only.
 * `pollMs`: re-check every so often (30000 is a good choice); off by default.
 */
export function ApprovalInbox({ pollMs }: { pollMs?: number }) {
  const list = useResource<ApprovalList>("/api/pramaan/approvals", pollMs);
  const now = useNow();
  const [selected, setSelected] = useState<string>();
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  useEffect(() => setHistory(readHistory()), []);

  const viewer = list.data?.viewer ?? { canApprove: false };
  const pending = list.data?.results ?? [];

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <div className="space-y-3">
        {list.data && !viewer.canApprove && (
          <p className="rounded-md bg-muted p-3 text-sm">You can see these requests, but only an approver can decide them.</p>
        )}
        <Tabs defaultValue="pending">
          <TabsList>
            <TabsTrigger value="pending">Pending ({pending.length})</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>
          <TabsContent value="pending" className="space-y-2">
            {!list.data ? (
              list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : <LoadingState label="Loading requests" />
            ) : (
              <>
                {list.error && <ErrorState error={list.error} onRetry={list.reload} />}
                {pending.length === 0 ? (
                  <EmptyState title="Nothing is waiting for you">New requests that need a yes show up here.</EmptyState>
                ) : (
                  <ul className="pr-rows" aria-label="Requests waiting for approval">
                    {pending.map((a) => (
                      <li key={a.approval_id}>
                        <button
                          type="button"
                          className="pr-row"
                          aria-pressed={selected === a.approval_id}
                          onClick={() => setSelected(a.approval_id)}
                        >
                          <span className="pr-row-main">
                            <b>{actionName(a.capability)}</b>
                            <span className="pr-row-sub">
                              {requesterLabel(a.requested_by)} · {formatDate(a.created_at)} ·{" "}
                              {upTo(a.price_micro)}
                            </span>
                          </span>
                          <span className="pr-row-side">
                            <StateBadge state={now > 0 && Date.parse(a.expires_at) <= now ? "expired" : "pending"} />
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </TabsContent>
          <TabsContent value="history" className="space-y-2">
            {history.length === 0 ? (
              <EmptyState title="No decisions yet">Requests you approve or decline here are listed in this tab.</EmptyState>
            ) : (
              <ul className="pr-rows" aria-label="Your decisions">
                {history.map((h) => (
                  <li key={h.id}>
                    <button
                      type="button"
                      className="pr-row"
                      aria-pressed={selected === h.id}
                      data-approval-id={h.id}
                      onClick={() => setSelected(h.id)}
                    >
                      <span className="pr-row-main">
                        <b>{h.capability ? actionName(h.capability) : "A request"}</b>
                        <span className="pr-row-sub">
                          {h.decision === "approve" ? "Approved" : "Declined"} · {formatDate(h.at)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
        </Tabs>
      </div>
      <section aria-label="Request details">
        {selected ? (
          <ApprovalDetail
            key={selected}
            id={selected}
            viewer={viewer}
            onDecided={() => {
              setHistory(readHistory());
              list.reload();
            }}
          />
        ) : (
          <EmptyState title="Choose a request">Its exact inputs, effect and maximum price show here.</EmptyState>
        )}
      </section>
    </div>
  );
}
