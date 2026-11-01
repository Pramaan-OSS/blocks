import { PageTitle } from "@/components/pramaan/parts";
import { PlanCard } from "@/components/pramaan/subscriptions/plan-card";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <div className="space-y-6">
      <PageTitle title="Your plan">What you pay, when it renews, and a way to manage it.</PageTitle>
      <PlanCard emptyHref="/checkout" />
    </div>
  );
}
