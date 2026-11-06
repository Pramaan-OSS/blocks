import { MyApplications } from "@/components/pramaan/applications/applications-panel";
import { PageTitle } from "@/components/pramaan/parts";
export default function Page() { return <div className="space-y-6"><PageTitle title="Your applications">See where each application stands.</PageTitle><MyApplications /></div>; }
