import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { ApiError } from "@/lib/pramaan/client";
import { cn } from "@/lib/utils";

// The states every block screen shows: loading, empty, error, needs connection, and a live
// status line for success and failure.

export function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="p-6 text-sm text-muted-foreground">
      {label}…
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="pr-empty">
      <b>{title}</b>
      {children && <p>{children}</p>}
    </div>
  );
}

export function NeedsConnection({ message, next }: { message: string; next?: string }) {
  return (
    <div role="alert" className="pr-card text-sm">
      <p className="font-medium">{message}</p>
      {next && <p className="mt-1 text-muted-foreground">{next}</p>}
    </div>
  );
}

/** The one signed-out state every block shares: a plain line, then why this block needs a person. */
export function SignedOutState({ reason }: { reason?: string }) {
  return (
    <div role="status" className="pr-card text-sm">
      <p className="font-medium">Sign in to see this.</p>
      {reason && <p className="mt-1 text-muted-foreground">{reason}</p>}
    </div>
  );
}

/** Shows plain wording for the error. Signed-out and connection errors get their own states. */
export function ErrorState({ error, onRetry, walletHref }: { error: ApiError; onRetry?: () => void; walletHref?: string }) {
  if (error.code === "signed_out") return <SignedOutState reason={error.next} />;
  if (error.code === "connection_required") return <NeedsConnection message={error.message} next={error.next} />;
  return (
    <div role="alert" className="pr-card border-destructive/50 text-sm">
      <p className="font-medium text-destructive">{error.message}</p>
      {error.next && <p className="mt-1 text-muted-foreground">{error.next}</p>}
      {error.topUp && (
        // A low-balance refusal: go to the wallet block when the app has one, else to the API's link.
        <p className="mt-2">
          <a
            className="font-medium underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href={walletHref ?? error.topUp.links[0]?.url ?? "#"}
          >
            {error.topUp.links[0]?.label ?? "Add credit"}
          </a>
        </p>
      )}
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export type StatusTone = "success" | "error" | "info";

/** A live region: keep it mounted and change its text, so screen readers announce each update. */
export function StatusMessage({ text, tone = "info" }: { text?: string; tone?: StatusTone }) {
  return (
    <p
      role="status"
      aria-live="polite"
      className={cn(
        "min-h-5 text-sm empty:hidden",
        tone === "success" && "font-medium text-foreground",
        tone === "error" && "text-destructive",
        tone === "info" && "text-muted-foreground",
      )}
    >
      {text}
    </p>
  );
}
