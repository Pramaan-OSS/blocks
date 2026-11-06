import { MessagingPanel } from "@/components/pramaan/messaging/messaging-panel";
import { PageTitle } from "@/components/pramaan/parts";
import { SampleMember } from "../feed/sample-member";
export default function Page() { return <div className="space-y-6"><PageTitle title="Messages">Private conversations with one other person.</PageTitle><SampleMember /><MessagingPanel /></div>; }
