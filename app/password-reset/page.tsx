import { PasswordPanel } from "@/components/pramaan/password-reset/password-panel";
import { PageTitle } from "@/components/pramaan/parts";
import { SampleMailbox } from "./sample-mailbox";
import { passwordResetDemoAllowed } from "@/lib/pramaan/password-reset-runtime";

export const dynamic = "force-dynamic";
export default function Page() {
  return <div className="space-y-6">
    <PageTitle title="Passwords">Reset a forgotten password or change it while signed in.</PageTitle>
    <PasswordPanel />
    {passwordResetDemoAllowed() && <SampleMailbox />}
  </div>;
}
