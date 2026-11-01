import { beforeEach, expect, it } from "vitest";
import { fakeState, resetFake } from "@/lib/pramaan/fake";
import { assessmentState, finishInvitation } from "@/lib/pramaan/fake-assessment";
import { get, post } from "./harness";

// The plan's "done when", end to end on the fake: draft, published, invite, result, integrity, and a
// revoke that releases the credit held for the invitation.

const A = "/api/pramaan/assessment";
beforeEach(() => resetFake());

it("draft to published to invite to result to integrity, and a revoke releases the held credit", async () => {
  const held = () => [...fakeState().holds.values()].reduce((n, x) => n + x, 0);
  const { ref } = await (await post("mbr_owner", `${A}/exams`, { title: "Flow", durationMinutes: 10, proctoring: { enabled: false } })).json();
  await post("mbr_owner", `${A}/exams/${ref}/questions`, { type: "text", text: "Say hello.", points: 4 });
  await post("mbr_owner", `${A}/exams/${ref}/publish`);
  const start = held();

  const { results } = await (await post("mbr_owner", `${A}/exams/${ref}/invitations`, { emails: ["a@example.com", "b@example.com"], delivery: { mode: "link" } }, { "Idempotency-Key": "flow" })).json();
  expect(held()).toBe(start + 1_000_000);

  finishInvitation(fakeState(), results[0].ref, 90);
  expect(held()).toBe(start + 500_000);
  expect((await (await get("mbr_owner", `${A}/invitations/${results[0].ref}/result`)).json()).score).toBe(90);
  expect((await (await get("mbr_owner", `${A}/invitations/${results[0].ref}/integrity`)).json()).verdict).toBe("clean");

  await post("mbr_owner", `${A}/invitations/${results[1].ref}/revoke`);
  const wait = (await (await get("mbr_owner", "/api/pramaan/approvals")).json()).results.find((a: { capability: string }) => a.capability === "assessment.invitation.revoke");
  await post("mbr_owner", `/api/pramaan/approvals/${wait.approval_id}/decide`, { decision: "approve" });
  expect((await (await get("mbr_owner", `${A}/invitations/${results[1].ref}`)).json()).status).toBe("revoked");
  expect(assessmentState(fakeState()).invites.get(results[1].ref)!.status).toBe("revoked");
  expect(held()).toBe(start);
});
