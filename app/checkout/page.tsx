import { CheckoutButton } from "@/components/pramaan/checkout/checkout-button";
import { PageTitle } from "@/components/pramaan/parts";
import { formatCents as money } from "@/lib/pramaan/plain";
import { PLANS } from "@/lib/pramaan/checkout-plans";

export default function Page() {
  return (
    <div className="space-y-8">
      <PageTitle title="Checkout">Pick a plan and pay on a secure payment page.</PageTitle>
      <ul className="grid gap-4 md:grid-cols-2" aria-label="Plans">
        {Object.entries(PLANS).map(([key, plan]) => (
          <li key={key} className="pr-card space-y-3">
            <h2>{plan.name}</h2>
            <p className="text-2xl">
              {money(plan.amountCents, plan.currency)}
              {plan.interval && <span className="text-sm text-muted-foreground"> a {plan.interval}</span>}
            </p>
            <CheckoutButton plan={key} label={`Pay for ${plan.name}`} />
          </li>
        ))}
      </ul>
    </div>
  );
}
