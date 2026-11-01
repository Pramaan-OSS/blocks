import { beforeEach, describe, expect, it } from "vitest";
import { finishInvitation, assessmentState, sentEmails } from "@/lib/pramaan/fake-assessment";
import { failNext, fakeState, resetFake } from "@/lib/pramaan/fake";
import { get, post } from "./harness";

const A = "/api/pramaan/assessment";
const owner = "mbr_owner";

beforeEach(() => {
  resetFake();
});

const json = async (res: Response) => ({ status: res.status, body: await res.json() });
const newExam = async () =>
  (await json(await post(owner, `${A}/exams`, { title: "Data analyst screen", durationMinutes: 30, passScore: 60, proctoring: { enabled: true, profile: "record" }, identityRequired: true }))).body.ref as string;
const mcq = { type: "mcq", text: "Is NULL equal to NULL in SQL?", points: 5, options: [{ text: "Yes", isCorrect: false }, { text: "No", isCorrect: true }] };

describe("assessment routes", () => {
  it("an exam goes draft, published, invited, graded, and its integrity report is read", async () => {
    const ref = await newExam();
    let exam = (await json(await get(owner, `${A}/exams/${ref}`))).body;
    expect(exam).toMatchObject({ status: "draft", title: "Data analyst screen", questions: [] });

    expect((await post(owner, `${A}/exams/${ref}/questions`, mcq)).status).toBe(201);
    expect((await post(owner, `${A}/exams/${ref}/questions`, { type: "text", text: "Explain a left join.", points: 10, maxWords: 120 })).status).toBe(201);
    exam = (await json(await get(owner, `${A}/exams/${ref}`))).body;
    expect(exam.questions.map((q: { order: number; type: string }) => [q.order, q.type])).toEqual([[1, "mcq"], [2, "text"]]);
    expect(exam.questions[0].content).toEqual({ options: mcq.options, allowMultiple: false });

    expect((await json(await post(owner, `${A}/exams/${ref}/publish`))).body).toEqual({ status: "active" });
    const frozen = await json(await post(owner, `${A}/exams/${ref}/questions`, mcq));
    expect(frozen).toMatchObject({ status: 409, body: { error: { message: "This exam is published, so its questions are frozen." } } });
    const again = await json(await post(owner, `${A}/exams/${ref}/publish`));
    expect(again.status).toBe(409);

    const invited = (await json(await post(owner, `${A}/exams/${ref}/invitations`, { emails: ["Sam@Example.com", "sam@example.com", "lee@example.com"], delivery: { mode: "link" } }, { "Idempotency-Key": "k1" }))).body.results;
    expect(invited.map((r: { email: string }) => r.email)).toEqual(["sam@example.com", "lee@example.com"]);
    expect(invited[0]).toMatchObject({ created: true, emailed: "not_requested" });
    expect(invited[0].link).toMatch(/^https:\/\//);

    const rows = (await json(await get(owner, `${A}/exams/${ref}/invitations`))).body.results;
    expect(rows.filter((r: { ref: string }) => invited.some((i: { ref: string }) => i.ref === r.ref))).toHaveLength(2);

    // Not graded yet: the answer says so, in the API's own words.
    const early = await json(await get(owner, `${A}/invitations/${invited[0].ref}/result`));
    expect(early.status).toBe(404);
    expect(early.body.error.message).toBe("Not ready yet. Grading is still running; try again in a minute.");

    finishInvitation(fakeState(), invited[0].ref, 88);
    const result = (await json(await get(owner, `${A}/invitations/${invited[0].ref}/result`))).body;
    expect(result).toMatchObject({ score: 88, passed: true, gradingStatus: "complete" });
    expect(result.grading).toHaveLength(2);
    const report = (await json(await get(owner, `${A}/invitations/${invited[0].ref}/integrity`))).body;
    expect(report).toMatchObject({ verdict: "clean", coverage: { evidenceComplete: true } });
  });

  it("refuses to publish an empty exam, and checks questions before sending them", async () => {
    const ref = await newExam();
    expect((await json(await post(owner, `${A}/exams/${ref}/publish`))).body.error.message).toBe("Add at least one question before publishing.");
    const noCorrect = await json(await post(owner, `${A}/exams/${ref}/questions`, { ...mcq, options: [{ text: "Yes" }, { text: "No" }] }));
    expect(noCorrect).toMatchObject({ status: 400, body: { error: { message: "Mark at least one option as correct." } } });
    const blank = await json(await post(owner, `${A}/exams/${ref}/questions`, { type: "text", text: " " }));
    expect(blank.status).toBe(400);
    expect(fakeState().requests.some((r) => r.path.endsWith("assessment.question.create"))).toBe(false);
    const noTitle = await json(await post(owner, `${A}/exams`, { durationMinutes: 20 }));
    expect(noTitle.body.error.message).toBe("Give the exam a title.");
  });

  it("emails go from the person's own account, wait for approval, and the same click never invites twice", async () => {
    const body = { emails: ["sam@example.com"], delivery: { mode: "email", sender: "own", subject: "Your test", message: "Hi Sam, take it here: {link}" } };
    const first = (await json(await post(owner, `${A}/exams/exm_active1/invitations`, body, { "Idempotency-Key": "click-1" }))).body.results[0];
    expect(first.emailed).toBe("waiting_for_approval");
    const second = (await json(await post(owner, `${A}/exams/exm_active1/invitations`, body, { "Idempotency-Key": "click-1" }))).body.results[0];
    expect(second).toMatchObject({ ref: first.ref, created: false });
    expect(assessmentState(fakeState()).emails).toHaveLength(1);
    expect(sentEmails(fakeState())).toHaveLength(0);

    const inbox = (await json(await get(owner, "/api/pramaan/approvals"))).body.results;
    const mail = inbox.find((a: { capability: string; input: unknown }) => a.capability === "email.send" && JSON.stringify(a.input).includes(first.link));
    expect(mail.input.text).toBe(`Hi Sam, take it here: ${first.link}`);
    expect(mail.input.sender).toBeUndefined();
    await post(owner, `/api/pramaan/approvals/${mail.approval_id}/decide`, { decision: "approve" });
    expect(sentEmails(fakeState())).toHaveLength(1);
    const row = (await json(await get(owner, `${A}/invitations/${first.ref}`))).body;
    expect(row.emailedAt).toBeTruthy();
  });

  it("never sends an invitation from a Pramaan address, and says what to do instead", async () => {
    const base = { emails: ["sam@example.com"], delivery: { mode: "email", sender: "domain", subject: "Your test", message: "{link}" } };
    const pramaan = await json(await post(owner, `${A}/exams/exm_active1/invitations`, { ...base, delivery: { ...base.delivery, from: "tests@mail.pramaan.dev" } }));
    expect(pramaan).toMatchObject({ status: 400, body: { error: { message: "Invitations send from your own Gmail or Outlook, or a domain you verified, never a Pramaan address." } } });
    const missing = await json(await post(owner, `${A}/exams/exm_active1/invitations`, base));
    expect(missing.status).toBe(400);
    expect(fakeState().requests.some((r) => r.path.includes("invitation.create") || r.path.includes("email.send"))).toBe(false);
    const own = await json(await post(owner, `${A}/exams/exm_active1/invitations`, { ...base, delivery: { ...base.delivery, from: "hiring@acme.test" } }));
    expect(own.status).toBe(201);
    const sent = fakeState().requests.find((r) => r.path.endsWith("email.send"))!;
    expect(sent.body).toMatchObject({ sender: "domain", from: "hiring@acme.test" });
  });

  it("revoke waits for approval; the held credit comes back once it is approved", async () => {
    const held = () => [...fakeState().holds.values()].reduce((n, x) => n + x, 0);
    assessmentState(fakeState()); // seeds the invitations and the credit held for them
    const before = held();
    expect(before).toBe(1_000_000); // Ada (unused) and Grace (started) each hold one session
    const res = await json(await post(owner, `${A}/invitations/inv_ada/revoke`));
    expect(res.body).toEqual({ status: "waiting_for_approval" });
    expect(held()).toBe(before);
    expect((await json(await get(owner, `${A}/invitations/inv_ada`))).body.status).toBe("pending");

    const inbox = (await json(await get(owner, "/api/pramaan/approvals"))).body.results;
    const wait = inbox.find((a: { capability: string }) => a.capability === "assessment.invitation.revoke");
    await post(owner, `/api/pramaan/approvals/${wait.approval_id}/decide`, { decision: "approve" });
    const after = (await json(await get(owner, `${A}/invitations/inv_ada`))).body;
    expect(after.status).toBe("revoked");
    expect(after.revokedAt).toBeTruthy();
    expect(held()).toBe(before - 500_000);
  });

  it("a candidate who already started can't be revoked", async () => {
    const res = await json(await post(owner, `${A}/invitations/inv_grace/revoke`));
    expect(res).toMatchObject({ status: 409, body: { error: { message: "This candidate already started or the invitation ended, so it can't be withdrawn." } } });
  });

  it("shows the price a confirm needs, and nothing for an action it doesn't price", async () => {
    const ok = await json(await post(owner, `${A}/estimate`, { capability: "assessment.exam.publish", input: { ref: "exm_draft1" } }));
    expect(ok.body).toEqual({ price_max_micro: 13_000 });
    expect((await json(await post(owner, `${A}/estimate`, { capability: "llm.chat" }))).status).toBe(400);
  });

  it("passes the API's own error message through", async () => {
    failNext("POST", "/v1/capabilities/assessment.exam.publish", 429, { code: "rate_limited", message: "Too many requests. Wait a minute, then try again." });
    const res = await json(await post(owner, `${A}/exams/exm_draft1/publish`));
    expect(res).toMatchObject({ status: 429, body: { error: { code: "rate_limited", message: "Too many requests. Wait a minute, then try again." } } });
  });
});
