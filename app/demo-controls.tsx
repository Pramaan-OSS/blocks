"use client";

import { Button } from "@/components/ui/button";
import { announceChange } from "@/lib/pramaan/client";

// Demo only (PRAMAAN_FAKE=1): pick who is signed in, and hold a new send for approval.

// `none` is a real signed-out choice; with no cookie at all the demo signs in the owner.
function viewAs(member: string) {
  document.cookie = `pramaan_member=${member}; path=/; SameSite=Lax`;
  location.reload();
}

export function DemoControls() {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed p-3 text-sm">
      <span className="text-muted-foreground">Demo:</span>
      <Button size="sm" variant="outline" onClick={() => viewAs("mbr_owner")}>
        Sign in as approver
      </Button>
      <Button size="sm" variant="outline" onClick={() => viewAs("mbr_viewer")}>
        Sign in as viewer
      </Button>
      <Button size="sm" variant="outline" onClick={() => viewAs("none")}>
        Sign out
      </Button>
      <Button
        size="sm"
        onClick={async () => {
          await fetch("/api/demo", { method: "POST", body: JSON.stringify({ action: "send" }) });
          announceChange();
        }}
      >
        Create a demo send
      </Button>
    </div>
  );
}
