import { CheckoutStatus } from "@/components/pramaan/checkout/checkout-button";
import { PageTitle } from "@/components/pramaan/parts";

// Where the customer lands after the payment page (successUrl). Reads the result from this browser.
export default function Page() {
  return (
    <div className="space-y-6">
      <PageTitle title="Your payment">We're checking that your payment went through.</PageTitle>
      <CheckoutStatus />
    </div>
  );
}
