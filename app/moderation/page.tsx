import { ModerationPanel } from "@/components/pramaan/moderation/moderation-panel";
import { PageTitle } from "@/components/pramaan/parts";
import { CommunityDemo } from "./community-demo";
export default function Page() { return <div className="space-y-6"><PageTitle title="Community safety" /><CommunityDemo /><ModerationPanel /></div>; }
