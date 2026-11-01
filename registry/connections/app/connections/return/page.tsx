import { ConnectionReturn } from "@/components/pramaan/connections/connections-manager";

// Where people land after the hosted sign-in (`returnPath` of ConnectionsManager). The app comes from ?app=.
export default function Page() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Connecting</h1>
      <ConnectionReturn />
    </div>
  );
}
