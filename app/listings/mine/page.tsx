import { MyListings } from "@/components/pramaan/listings/listings-panel";
import { PageTitle } from "@/components/pramaan/parts";
export default function Page() { return <div className="space-y-6"><PageTitle title="Your listings">Post, edit and close what you offer.</PageTitle><MyListings withApplications /></div>; }
