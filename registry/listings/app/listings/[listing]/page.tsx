import { Suspense } from "react";
import { ListingDetail } from "@/components/pramaan/listings/listings-panel";
import { PageTitle } from "@/components/pramaan/parts";
type Props = { params: Promise<{ listing: string }> };
async function ListingContent({ params }: Props) {
  const { listing } = await params;
  return <ListingDetail id={listing} />;
}
export default function Page({ params }: Props) {
  return <div className="space-y-6"><PageTitle title="Listing" /><Suspense fallback={<p role="status">Loading listing…</p>}><ListingContent params={params} /></Suspense></div>;
}
