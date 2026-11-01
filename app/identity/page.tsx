import { IdentityCheck } from "@/components/pramaan/identity/identity-check";
import { PageTitle } from "@/components/pramaan/parts";

export default function Page() {
  return (
    <div className="space-y-8">
      <PageTitle title="Identity check">Confirm who you are with an ID document and a selfie.</PageTitle>
      <IdentityCheck />
    </div>
  );
}
