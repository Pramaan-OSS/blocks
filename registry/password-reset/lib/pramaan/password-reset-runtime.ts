import "server-only";
import { createPasswordReset, hashResetPassword, proofHash, type ResetOptions } from "./password-reset";
import type { ResetMail } from "./password-reset-sender";
import { memoryResetStore } from "./password-reset-store";

const runtime = globalThis as typeof globalThis & {
  __passwordResetOptions?: ResetOptions;
  __passwordResetFake?: ReturnType<typeof makeFake>;
};
function makeFake() {
  const state = memoryResetStore();
  const mail: ResetMail[] = [];
  const ready = hashResetPassword("Starting password 42").then((passwordHash) => {
    state.users.set("sample-person", { id: "sample-person", email: "sam@example.com", passwordHash });
  });
  return { ...state, mail, ready };
}

export function passwordResetDemoAllowed(request?: Request) {
  if (process.env.PRAMAAN_FAKE !== "1") return false;
  if (process.env.NODE_ENV !== "production") return true;
  if (process.env.PRAMAAN_PASSWORD_RESET_TEST_MODE !== "1") return false;
  try {
    const origin = new URL(process.env.PRAMAAN_PASSWORD_RESET_ORIGIN ?? "");
    return ["localhost", "127.0.0.1"].includes(origin.hostname) && (!request || new URL(request.url).origin === origin.origin);
  } catch { return false; }
}
export async function passwordResetFake() {
  if (!passwordResetDemoAllowed()) throw new Error("Sample accounts are unavailable.");
  const state = runtime.__passwordResetFake ??= makeFake();
  await state.ready;
  return state;
}
export function resetPasswordResetFake() { delete runtime.__passwordResetFake; }

/** Call once from the app's server configuration, with its database and verified session lookup. */
export function configurePasswordReset(options: ResetOptions) { runtime.__passwordResetOptions = options; }

export async function handlePasswordReset(request: Request) {
  if (process.env.PRAMAAN_FAKE === "1") {
    if (!passwordResetDemoAllowed(request)) return unavailable();
    const state = await passwordResetFake();
    const origin = process.env.PRAMAAN_PASSWORD_RESET_ORIGIN ?? "http://localhost:3100";
    return createPasswordReset({
      store: state.store, sender: { send: async (message) => { state.mail.push(message); return "accepted"; } }, origin,
      currentUser: async (req) => {
        const token = req.headers.get("cookie")?.split(";").map((c) => c.trim()).find((c) => c.startsWith("reset_session="))?.slice("reset_session=".length);
        return token ? state.sessions.get(proofHash(token)) : undefined;
      },
    }).handle(request);
  }
  if (runtime.__passwordResetOptions) return createPasswordReset(runtime.__passwordResetOptions).handle(request);
  return unavailable();
}

const unavailable = () => Response.json({ message: "Passwords are unavailable right now. Please try again later." }, { status: 503, headers: { "cache-control": "no-store" } });
