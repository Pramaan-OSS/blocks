"use client";

import { loadConnectAndInitialize } from "@stripe/connect-js";
import { ConnectAccountOnboarding, ConnectBalances, ConnectComponentsProvider, ConnectPayouts } from "@stripe/react-connect-js";
import { useState } from "react";

// The provider's own embedded screens. Only their appearance options are set (colour, font, radius),
// from the Pramaan theme; the screens themselves are not re-skinned. This file loads only when a
// real session is opened, so the provider's script is never fetched in fake mode or for a read-only view.

export interface Session {
  clientSecret: string;
  publishableKey: string;
}

export default function ProviderSetup({ session, view, refresh, onExit }: { session: Session; view: "setup" | "manage"; refresh: () => Promise<Session>; onExit: () => void }) {
  const [instance] = useState(() => {
    let first: string | undefined = session.clientSecret;
    return loadConnectAndInitialize({
      publishableKey: session.publishableKey,
      // The first secret is the one just made; later ones (an expired session) are made fresh.
      fetchClientSecret: async () => {
        const secret = first;
        first = undefined;
        return secret ?? (await refresh()).clientSecret;
      },
      appearance: { variables: { colorPrimary: "#2b59d1", borderRadius: "10px", fontFamily: "Geist, system-ui, sans-serif" } },
    });
  });
  return (
    <ConnectComponentsProvider connectInstance={instance}>
      {view === "setup" ? (
        <ConnectAccountOnboarding onExit={onExit} />
      ) : (
        <div className="space-y-4">
          <ConnectBalances />
          <ConnectPayouts />
        </div>
      )}
    </ConnectComponentsProvider>
  );
}
