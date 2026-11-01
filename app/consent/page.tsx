import { ConsentBadge, ConsentManager } from "@/components/pramaan/consent/consent-manager";
import { PageTitle } from "@/components/pramaan/parts";

export default function Page() {
  return (
    <div className="space-y-8">
      <PageTitle title="Opt-outs">Who you must not message, and how to let people stop hearing from you.</PageTitle>
      <ConsentManager />
      <section className="space-y-2">
        <h2>A contact's status</h2>
        <p className="text-sm text-muted-foreground">A badge you can put on a contact's page.</p>
        <p className="flex items-center gap-3 text-sm">
          Sample contact <ConsentBadge address="+14155550100" channel="sms" />
        </p>
      </section>
    </div>
  );
}
