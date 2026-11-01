// What you sell. The browser sends only a plan key, never a price: the price comes from here, on
// the server, so a visitor can't pay less by editing the request. Replace these with your own, or
// load them from your database in `createCheckout`. Amounts are whole cents.

export interface Plan {
  readonly name: string;
  readonly amountCents: number;
  /** Three lowercase letters. */
  readonly currency: string;
  /** Set for a repeating charge. Leave out for a one-time payment. */
  readonly interval?: "month" | "year";
}

export const PLANS: Record<string, Plan> = {
  starter: { name: "Starter", amountCents: 2_000, currency: "usd" },
  team: { name: "Team", amountCents: 9_900, currency: "usd", interval: "month" },
};
