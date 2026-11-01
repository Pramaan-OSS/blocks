import { ActivityLog } from "@/components/pramaan/activity/activity-log";
import { PageTitle } from "@/components/pramaan/parts";

export default function Page() {
  return (
    <div className="space-y-6">
      <PageTitle title="Activity">What ran, what it cost, and what went wrong.</PageTitle>
      <ActivityLog />
    </div>
  );
}
