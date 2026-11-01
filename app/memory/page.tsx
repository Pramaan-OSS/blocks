import { MemoryViewer } from "@/components/pramaan/memory/memory-viewer";
import { PageTitle } from "@/components/pramaan/parts";

export default function Page() {
  return (
    <div className="space-y-6">
      <PageTitle title="Memory">What the assistant remembers about you and your team.</PageTitle>
      <MemoryViewer approvalsHref="/" />
    </div>
  );
}
