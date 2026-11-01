import { randomBytes } from "node:crypto";
import { passwordResetDemoAllowed, passwordResetFake, resetPasswordResetFake } from "@/lib/pramaan/password-reset-runtime";
import { proofHash, verifyAndUpgradeResetPassword } from "@/lib/pramaan/password-reset";
import { resetPublicLimits, clientIp, limitPublic } from "@/lib/pramaan/public-guard";

const unavailable = () => new Response(null, { status: 404 });
export async function GET(request: Request) {
  if (!passwordResetDemoAllowed(request)) return unavailable();
  const origin = request.headers.get("origin");
  // Browsers omit Origin on same-origin GETs, but supply a browser-controlled fetch-site marker.
  if (origin ? origin !== new URL(request.url).origin : request.headers.get("sec-fetch-site") !== "same-origin") return new Response(null, { status: 403 });
  const state = await passwordResetFake();
  const links = state.mail.flatMap((mail) => mail.text.match(/https?:\/\/[^\s]+\/password-reset#token=[A-Za-z0-9_-]{43}/g) ?? []);
  return Response.json({ links }, { headers: { "cache-control": "no-store" } });
}
export async function POST(request: Request) {
  if (!passwordResetDemoAllowed(request)) return unavailable();
  if (request.headers.get("origin") !== new URL(request.url).origin) return new Response(null, { status: 403 });
  const body = await request.json();
  if (body.action === "reset") { resetPasswordResetFake(); resetPublicLimits(); }
  if (body.action === "signin") {
    try {
      limitPublic("password-reset-demo-signin-ip", clientIp(request), 10, 15 * 60_000);
      limitPublic("password-reset-demo-signin-account", "sample-account", 5, 15 * 60_000);
    }
    catch { return Response.json({ message: "Too many attempts. Please try again later." }, { status: 429 }); }
    const state = await passwordResetFake();
    const user = await state.store.find("sam@example.com");
    if (typeof body.password !== "string" || body.password.length > 1024 || !user || !await verifyAndUpgradeResetPassword(state.store, user, body.password)) return Response.json({ message: "Email or password is incorrect." }, { status: 401 });
    const token = randomBytes(32).toString("hex");
    state.sessions.set(proofHash(token), user.id);
    return Response.json({ message: "Signed in." }, { headers: { "cache-control": "no-store", "set-cookie": `reset_session=${token}; HttpOnly; SameSite=Lax; Path=/${new URL(request.url).protocol === "https:" ? "; Secure" : ""}` } });
  }
  return Response.json({ ok: true });
}
