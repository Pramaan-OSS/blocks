import { Suspense } from "react";
import { PersonPosts } from "@/components/pramaan/feed/feed-panel";
import { PublicProfilePanel } from "@/components/pramaan/profiles/profile-panel";
import { PageTitle } from "@/components/pramaan/parts";
type Props = { params: Promise<{ person: string }> };
async function ProfileContent({ params }: Props) {
  const { person } = await params;
  return <div className="space-y-6"><PublicProfilePanel person={person} /><PersonPosts person={person} messagesHref="/messages" /></div>;
}
// The demo shows the feed block's profile page with the messaging link switched on.
export default function Page({ params }: Props) {
  return <div className="space-y-6"><PageTitle title="Profile" /><Suspense fallback={<p role="status">Loading profile…</p>}><ProfileContent params={params} /></Suspense></div>;
}
