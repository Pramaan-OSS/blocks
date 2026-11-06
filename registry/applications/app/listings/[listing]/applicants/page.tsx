import { Suspense } from "react";
import { ApplicantsPanel } from "@/components/pramaan/applications/applications-panel";
import { PageTitle } from "@/components/pramaan/parts";
type Props = { params: Promise<{ listing: string }> };
async function ApplicantsContent({ params }: Props) {
  const { listing } = await params;
  return <ApplicantsPanel listing={listing} />;
}
export default function Page({ params }: Props) {
  return <div className="space-y-6"><PageTitle title="Applicants" /><Suspense fallback={<p role="status">Loading applicants…</p>}><ApplicantsContent params={params} /></Suspense></div>;
}
