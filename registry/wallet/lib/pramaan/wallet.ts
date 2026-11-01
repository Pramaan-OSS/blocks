import "server-only";
import { PramaanError } from "@pramaan/sdk";
import { capability, pramaan } from "@/lib/pramaan/server";

// Server half of the wallet: GET /v1/balance, GET /v1/usage and, where you bill your own users,
// the billing.credits.balance superpower.

export interface Balance {
  /** Credit you can spend now, micro-USD. Credit set aside for running requests is already out of it. */
  readonly balance_micro: number;
  readonly today_spend_micro: number;
  /** null: no daily cap. */
  readonly daily_cap_micro: number | null;
  readonly daily_cap_message: string;
  /** Credit set aside for requests that are still running, micro-USD. */
  readonly held_micro: number;
}

export interface UsageRow {
  readonly day: string;
  readonly capability: string;
  readonly calls: number;
  readonly spend_micro: number;
}

export interface WalletSummary {
  readonly balance: Balance;
  /** Where to add credit. */
  readonly topUpUrl: string;
}

export interface Usage {
  readonly from: string;
  readonly to: string;
  readonly results: UsageRow[];
}

export interface CustomerCredits {
  readonly balances: readonly {
    readonly kind: string;
    readonly available: { readonly amount: number; readonly currency: string };
    readonly reserved?: { readonly amount: number; readonly currency: string };
  }[];
}

// No route returns the wallet link unless a call is refused for credit, so it comes from
// the environment, defaulting to the customer app's wallet page.
const topUpUrl = () => process.env.PRAMAAN_WALLET_URL || "https://app.pramaan.dev/settings/wallet";

export async function getWallet(): Promise<WalletSummary> {
  return { balance: await pramaan<Balance>("/v1/balance"), topUpUrl: topUpUrl() };
}

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Usage for the last `days` days, today included. */
export function getUsage(days: number): Promise<Usage> {
  if (!Number.isInteger(days) || days < 1 || days > 90)
    throw new PramaanError("invalid_request", "Ask for 1 to 90 days of usage.", { status: 400 });
  const to = Date.now();
  return pramaan<Usage>(`/v1/usage?from=${day(to - (days - 1) * 86_400_000)}&to=${day(to)}`);
}

/** A customer's prepaid credit, for apps that bill their own users. */
export function getCustomerCredits(customerId: string): Promise<CustomerCredits> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(customerId)) throw new PramaanError("invalid_request", "That customer id isn't valid.", { status: 400 });
  return capability<CustomerCredits>("billing.credits.balance", { customerId });
}
