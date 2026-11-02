import { Suspense } from "react";
import { PublicProfilePanel } from "@/components/pramaan/profiles/profile-panel";
import { PageTitle } from "@/components/pramaan/parts";
type Props = { params: Promise<{ person: string }> };
async function ProfileContent({ params }: Props) {
  const { person } = await params;
  return <PublicProfilePanel person={person} />;
}
export default function Page({ params }: Props) {
  return <div className="space-y-6"><PageTitle title="Profile" /><Suspense fallback={<p role="status">Loading profile…</p>}><ProfileContent params={params} /></Suspense></div>;
}
