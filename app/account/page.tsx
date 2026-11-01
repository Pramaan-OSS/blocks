import { AccountPanel } from "@/components/pramaan/account/account-panel";
import { PageTitle } from "@/components/pramaan/parts";
import { DemoControls } from "../demo-controls";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <div className="space-y-6">
      <PageTitle title="Account">Who you are, your organisation and your team.</PageTitle>
      {process.env.PRAMAAN_FAKE === "1" && <DemoControls />}
      <AccountPanel />
    </div>
  );
}
