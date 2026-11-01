/**
 * Who is signed in, as a Pramaan member_id (from GET /v1/members). Replace this body with your own
 * auth: look up the signed-in user and return the member_id you mapped them to. Return undefined
 * for anyone else; they get a read-only view.
 */
export async function currentMemberId(request: Request): Promise<string | undefined> {
  // Demo and tests only: with the fake on, a cookie picks the member, `none` means signed out, and
  // no cookie means the owner demo member. Never trust a cookie for this in production; it would
  // let anyone claim to be an approver.
  if (process.env.PRAMAAN_FAKE === "1") {
    const who = readCookie(request, "pramaan_member");
    return who === "none" ? undefined : (who ?? "mbr_owner");
  }
  return undefined;
}

/**
 * Your own reference for the signed-in person, as the connections block sends it to Pramaan
 * (`endUserRef`: 1 to 128 letters, digits, `_`, `.` or `-`; never an email or name). Replace this
 * body with your user id. Return undefined when nobody is signed in.
 */
export async function currentEndUserRef(request: Request): Promise<string | undefined> {
  // Demo and tests only, like the member cookie above.
  if (process.env.PRAMAAN_FAKE === "1") {
    if (readCookie(request, "pramaan_member") === "none") return undefined;
    return readCookie(request, "pramaan_user") ?? "user-42";
  }
  return undefined;
}

function readCookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("=")) || undefined;
  }
  return undefined;
}

/** Authorise writes using trusted membership data. Wire this alongside currentMemberId. */
export async function canWrite(member: string, scope: string): Promise<boolean> {
  if (process.env.PRAMAAN_FAKE === "1") return member === "mbr_owner" && scope === member;
  // Deny until the host app checks this member's write role in the chosen workspace.
  return false;
}
