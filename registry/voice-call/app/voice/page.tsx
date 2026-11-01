import { VoiceCall } from "@/components/pramaan/voice/voice-call";
import { PageTitle } from "@/components/pramaan/parts";

export default function Page() {
  return (
    <div className="space-y-6">
      <PageTitle title="Phone">Make calls from this page.</PageTitle>
      <div className="flex justify-center">
        <VoiceCall />
      </div>
    </div>
  );
}
