import { SuperpowerPicker } from "@/components/pramaan/picker/superpower-picker";
import { PageTitle } from "@/components/pramaan/parts";

export default function Page() {
  return (
    <div className="space-y-6">
      <PageTitle title="Find an action">Say what you want done, see what it costs, and run it.</PageTitle>
      <SuperpowerPicker approvalsHref="/" missionsHref="/missions" walletHref="/wallet?topup=1" />
    </div>
  );
}
