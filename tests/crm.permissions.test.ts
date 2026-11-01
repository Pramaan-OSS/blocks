import { afterEach, expect, it, vi } from "vitest";
import * as session from "@/lib/pramaan/session";
import { crmRoute } from "@/lib/pramaan/crm-data";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
it("review 5: a trusted production member is denied writes until canWrite is wired", async () => {
  vi.stubEnv("PRAMAAN_FAKE", "0");
  vi.spyOn(session, "currentMemberId").mockResolvedValue("trusted-member");
  const run = vi.fn(async () => ({ saved: true }));
  const request = () => new Request("http://localhost/api/pramaan/contacts", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const denied = await crmRoute(request(), run);
  expect(denied.status).toBe(403);
  expect(await denied.json()).toEqual({ error: { message: "You don't have permission to change this workspace." } });
  expect(run).not.toHaveBeenCalled();
  const permission = vi.spyOn(session, "canWrite").mockResolvedValue(true);
  expect((await crmRoute(request(), run)).status).toBe(200);
  expect(permission).toHaveBeenCalledWith("trusted-member", "trusted-member");
  expect(run).toHaveBeenCalledOnce();
});
it("review 5: fake permissions are the same hook, with owner-only writes", async () => {
  expect(await session.canWrite("mbr_owner", "mbr_owner")).toBe(true);
  expect(await session.canWrite("mbr_owner", "someone-else")).toBe(false);
  expect(await session.canWrite("mbr_viewer", "mbr_viewer")).toBe(false);
});
