import { beforeEach, describe, expect, it } from "vitest";
import { failNext, resetFake } from "@/lib/pramaan/fake";
import { currentEndUserRef, currentMemberId } from "@/lib/pramaan/session";
import { plainProblem } from "@/lib/pramaan/plain";
import { asMember, get, post } from "./harness";

beforeEach(() => resetFake());

// What a person must never read: keys, headers, env var names, status codes.
const DEV = /api[ -]?key|authorization|\bheaders?\b|PRAMAAN_[A-Z_]+|\b(?:HTTP|status) \d{3}\b/i;

describe("fake mode sign-in", () => {
  it("signs in the owner demo member when no cookie is set, and none means signed out", async () => {
    expect(await currentMemberId(asMember(undefined, "/x"))).toBe("mbr_owner");
    expect(await currentMemberId(asMember("mbr_viewer", "/x"))).toBe("mbr_viewer");
    expect(await currentMemberId(asMember("none", "/x"))).toBeUndefined();
    expect(await currentEndUserRef(asMember("none", "/x"))).toBeUndefined();
    expect(await currentEndUserRef(asMember(undefined, "/x"))).toBe("user-42");
  });
});

describe("signed out, every block says the same plain thing", () => {
  const routes: [string, string][] = [
    ["/api/pramaan/account", "get"],
    ["/api/pramaan/consent", "get"],
    ["/api/pramaan/payouts", "get"],
    ["/api/pramaan/connections", "get"],
    ["/api/pramaan/memory", "get"],
    ["/api/pramaan/identity", "post"],
    ["/api/pramaan/chat", "post"],
  ];
  it.each(routes)("%s", async (url, how) => {
    const res = how === "get" ? await get("none", url) : await post("none", url, { messages: [{ role: "user", content: "hi" }] });
    const { error } = (await res.json()) as { error: { code: string; message: string; next?: string } };
    expect(res.status).toBe(401);
    expect(error.code).toBe("signed_out");
    expect(error.message).toBe("Sign in to see this.");
    expect(error.next).toBeTruthy();
    expect(`${error.message} ${error.next}`).not.toMatch(DEV);
  });
});

describe("errors never show developer wording", () => {
  it("a refused key does not tell a person to send an API key in a header", async () => {
    failNext("GET", "/v1/balance", 401, { code: "unauthorized", message: "That API key isn't valid." });
    const { error } = (await (await get("mbr_owner", "/api/pramaan/wallet")).json()) as { error: { message: string; next?: string } };
    expect(`${error.message} ${error.next ?? ""}`).not.toMatch(DEV);
  });

  it("scrubs keys, headers, env names and status codes, and keeps plain words", () => {
    expect(plainProblem("internal", 500, "The API answered with HTTP 500.", "Retry later; contact support@pramaan.dev with request_id.")).toEqual({ message: "Something went wrong on our side. Try again in a minute." });
    expect(plainProblem("connection_required", 503, "Pramaan isn't connected yet.", "Set PRAMAAN_API_KEY on the server, then restart the app.")).toEqual({ message: "Pramaan isn't connected yet.", next: "Ask whoever runs this app to check its setup." });
    expect(plainProblem("conflict", 409, "Already decided.", "Retry with the same Idempotency-Key.")).toEqual({ message: "Already decided." });
    expect(plainProblem("rate_limited", 429, "Too many requests. Wait a minute.", "Wait a minute, then try again.")).toEqual({ message: "Too many requests. Wait a minute.", next: "Wait a minute, then try again." });
  });
});
