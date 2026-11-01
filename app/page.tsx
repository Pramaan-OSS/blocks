import { ApprovalInbox } from "@/components/pramaan/approvals/approval-inbox";
import { PageTitle } from "@/components/pramaan/parts";
import { DemoControls } from "./demo-controls";

// Read at request time, so `PRAMAAN_FAKE=1 next start` shows the demo controls.
export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <div className="space-y-6">
      <PageTitle title="Approvals">Everything waiting for a yes before it runs.</PageTitle>
      {process.env.PRAMAAN_FAKE === "1" && <DemoControls />}
      <ApprovalInbox pollMs={30_000} />
    </div>
  );
}
