import { PayoutsPanel } from "@/components/pramaan/payouts/payouts-panel";
import { PageTitle } from "@/components/pramaan/parts";

export default function Page() {
  return (
    <div className="space-y-8">
      <PageTitle title="Payouts">Set up your payment account and see when you can take payments.</PageTitle>
      <PayoutsPanel />
    </div>
  );
}
