import { UnsubscribePage } from "@/components/pramaan/consent/consent-manager";
import { PageTitle } from "@/components/pramaan/parts";

// The public page: no sign-in.
export default function Page() {
  return (
    <div className="space-y-6">
      <PageTitle title="Stop hearing from us">Enter your phone number or email and choose what to stop.</PageTitle>
      <UnsubscribePage title="Unsubscribe" />
    </div>
  );
}
