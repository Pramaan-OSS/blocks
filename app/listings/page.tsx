import { ListingsBrowser } from "@/components/pramaan/listings/listings-panel";
import { PageTitle } from "@/components/pramaan/parts";
export default function Page() { return <div className="space-y-6"><PageTitle title="Listings">Search what people have posted.</PageTitle><a className="underline" href="/listings/mine">Your listings</a><ListingsBrowser /></div>; }
