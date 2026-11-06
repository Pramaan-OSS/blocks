import { FeedPanel } from "@/components/pramaan/feed/feed-panel";
import { PageTitle } from "@/components/pramaan/parts";
import { SampleMember } from "./sample-member";
export default function Page() { return <div className="space-y-6"><PageTitle title="Feed">Posts from you and the people you follow.</PageTitle><SampleMember /><FeedPanel /></div>; }
