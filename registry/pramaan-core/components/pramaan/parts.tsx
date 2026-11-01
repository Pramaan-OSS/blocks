import type { ReactNode } from "react";

/** A serif page title with a one-line plain subtitle. */
export function PageTitle({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="pr-title">
      <h1>{title}</h1>
      {children && <p>{children}</p>}
    </header>
  );
}

export type PillTone = "amber" | "blue" | "green" | "grey" | "red";

/**
 * A soft status pill. Amber: not started or needs you. Blue: booked, in progress or connected
 * to a step. Green: finished. Grey: expired or off. Red: blocked.
 */
export function StatusPill({ tone = "grey", children }: { tone?: PillTone; children: ReactNode }) {
  return (
    <span className="pr-pill" data-tone={tone}>
      {children}
    </span>
  );
}
