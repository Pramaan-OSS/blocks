import { notFound } from "next/navigation";
import { StandIn } from "./stand-in";

// Demo only: stands in for the provider's hosted payment page when PRAMAAN_FAKE=1.
export const dynamic = "force-dynamic";

export default function Page() {
  if (process.env.PRAMAAN_FAKE !== "1") notFound();
  return <StandIn />;
}
