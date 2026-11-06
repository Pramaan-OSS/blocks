import { Suspense } from "react";
import { ApplyPanel } from "@/components/pramaan/applications/applications-panel";
import { PageTitle } from "@/components/pramaan/parts";
type Props = { params: Promise<{ listing: string }> };
async function ApplyContent({ params }: Props) {
  const { listing } = await params;
  return <ApplyPanel listing={listing} />;
}
export default function Page({ params }: Props) {
  return <div className="space-y-6"><PageTitle title="Apply" /><Suspense fallback={<p role="status">Loading listing…</p>}><ApplyContent params={params} /></Suspense></div>;
}
