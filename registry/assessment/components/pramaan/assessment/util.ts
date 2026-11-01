"use client";

import { useEffect, useState } from "react";
import { type ApiError, api } from "@/lib/pramaan/client";
import { formatDate } from "@/lib/pramaan/plain";
import type { PillTone } from "@/components/pramaan/parts";
import type { ExamSettings, InviteStatus } from "@/lib/pramaan/assessment";

/** The API says a result or report isn't there yet (still grading): show it as pending, with a retry. */
export const isNotReady = (e: ApiError) => e.status === 404 || e.status === 202 || e.status === 425 || e.code === "not_ready";

/** The most one action costs, for a confirm. Undefined until the answer arrives. */
export function usePrice(capability: string, input: unknown = {}): number | undefined {
  const [price, setPrice] = useState<number>();
  const key = JSON.stringify(input);
  useEffect(() => {
    let live = true;
    api<{ price_max_micro: number }>("/api/pramaan/assessment/estimate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capability, input: JSON.parse(key) }),
    }).then((r) => live && setPrice(r.price_max_micro), () => {});
    return () => {
      live = false;
    };
  }, [capability, key]);
  return price;
}

// The invitation list doesn't return who was invited, so this browser remembers the emails it invited.
// The same goes for each candidate's link: the list and the single read don't return it.
const MEMORY = "pramaan:assessment:emails";
const LINKS = "pramaan:assessment:links";
const read = (key = MEMORY): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "{}");
  } catch {
    return {};
  }
};
export const rememberEmail = (ref: string, email: string, link?: string) => {
  localStorage.setItem(MEMORY, JSON.stringify({ ...read(), [ref]: email }));
  if (link) localStorage.setItem(LINKS, JSON.stringify({ ...read(LINKS), [ref]: link }));
};
export const emailFor = (ref?: string): string | undefined => (ref ? read()[ref] : undefined);
/** The candidate's own link, if this browser created it. */
export const linkFor = (ref?: string): string | undefined => (ref ? read(LINKS)[ref] : undefined);

/** Soft pill colour for an invitation: not started amber, in progress blue, finished green, expired or withdrawn grey. */
export function stateTone(status: InviteStatus): PillTone {
  switch (status) {
    case "pending":
    case "opened":
      return "amber";
    case "started":
      return "blue";
    case "completed":
      return "green";
    default:
      return "grey";
  }
}

export function examStatus(status: ExamSettings["status"]): { label: string; tone: PillTone } {
  return status === "draft" ? { label: "Draft", tone: "amber" } : status === "active" ? { label: "Published", tone: "green" } : { label: "Archived", tone: "grey" };
}

/**
 * What the exam shows while a candidate is being watched, matched to the proctoring level:
 * the camera is on for observe, the session is recorded from record up.
 */
export function watchLabel(p: ExamSettings["proctoring"]): string | undefined {
  if (!p.enabled) return undefined;
  return p.profile === "observe" ? "Camera on" : "Recording";
}

/** What the tracker calls an invitation. */
export function stateLabel(status: InviteStatus, emailedAt?: string): string {
  switch (status) {
    case "pending":
    case "opened":
      return emailedAt ? "Sent" : "Link created";
    case "started":
      return "Started";
    case "completed":
      return "Finished";
    case "expired":
      return "Expired";
    case "revoked":
      return "Revoked";
  }
}

export const when = (iso?: string) => formatDate(iso);

/** Who a candidate is on screen: their email where this browser knows it, else "Candidate 1", "Candidate 2"... */
export const candidateName = (ref: string | undefined, index: number): string => emailFor(ref) ?? `Candidate ${index + 1}`;
