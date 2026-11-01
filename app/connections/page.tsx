import { ConnectionsManager } from "@/components/pramaan/connections/connections-manager";
import { PageTitle } from "@/components/pramaan/parts";

export default function Page() {
  return (
    <div className="space-y-6">
      <PageTitle title="Connections">Every connected account in one place.</PageTitle>
      <ConnectionsManager approvalsHref="/" />
    </div>
  );
}
