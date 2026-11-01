import { MissionRunner } from "@/components/pramaan/missions/mission-runner";
import { PageTitle } from "@/components/pramaan/parts";

export default function Page() {
  return (
    <div className="space-y-6">
      <PageTitle title="Missions">Start a mission, watch its steps, see the result and the cost.</PageTitle>
      <MissionRunner approvalsHref="/" walletHref="/wallet?topup=1" />
    </div>
  );
}
