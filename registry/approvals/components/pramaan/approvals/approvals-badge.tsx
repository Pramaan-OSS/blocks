"use client";

import { Badge } from "@/components/ui/badge";
import { useResource } from "@/lib/pramaan/client";
import type { ApprovalList } from "@/lib/pramaan/approvals";

/** How many requests wait for a yes, for a nav bar. Renders nothing at zero or on error. */
export function ApprovalsBadge({ pollMs = 30_000 }: { pollMs?: number }) {
  const { data } = useResource<ApprovalList>("/api/pramaan/approvals", pollMs);
  const count = data?.results.length ?? 0;
  if (count === 0) return null;
  return (
    <Badge aria-label={`${count} ${count === 1 ? "request" : "requests"} waiting for approval`}>{count}</Badge>
  );
}
