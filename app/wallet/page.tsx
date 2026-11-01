import { PageTitle } from "@/components/pramaan/parts";
import { CustomerCreditsCard, Wallet } from "@/components/pramaan/wallet/wallet-panel";

export default function Page() {
  return (
    <div className="space-y-8">
      <PageTitle title="Wallet">Your balance, what you spent, and what ran.</PageTitle>
      <Wallet pollMs={30_000} />
      {process.env.PRAMAAN_FAKE === "1" && (
        <section className="space-y-2">
          <h2>Credit a customer holds in your app</h2>
          <p className="text-sm text-muted-foreground">For apps that sell prepaid credit to their own customers: what one customer can still spend.</p>
          <CustomerCreditsCard customerId="cus_example" />
        </section>
      )}
    </div>
  );
}
