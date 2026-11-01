import "server-only";
import { readFile } from "node:fs/promises";
import { request } from "node:http";
import path from "node:path";

export type ResetMail = { to: string; subject: string; text: string };
export type SendOutcome = "accepted" | "not-sent" | "unknown";
export interface ResetSender { send(mail: ResetMail, key: string): Promise<SendOutcome> }

/** Refuse before disclosure: capability inputs can appear in an approver's inbox. */
export function capabilityResetSender(_from: string): ResetSender {
  return {
    async send() { return "not-sent"; },
  };
}

/** Kit transport: the local app email module owns the sender and its delivery limits. */
export function moduleResetSender(directory = "/pramaan-modules"): ResetSender {
  return {
    async send(mail, key) {
      let token: string;
      try { token = (await readFile(path.join(directory, "token"), "utf8")).trim(); }
      catch { return "not-sent"; }
      return new Promise<SendOutcome>((resolve) => {
        const body = JSON.stringify(mail);
        const req = request({
          socketPath: path.join(directory, "modules.sock"), path: "/v1/email", method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "content-length": Buffer.byteLength(body), "idempotency-key": key },
        }, (res) => {
          // Never return upstream text, addresses or credentials to a public caller.
          res.resume();
          res.on("error", () => resolve("unknown"));
          res.on("end", () => resolve(res.statusCode === 200 || res.statusCode === 202 ? "accepted" : res.statusCode === 504 ? "unknown" : "not-sent"));
        });
        const deadline = setTimeout(() => req.destroy(new Error("Email did not answer.")), 70_000);
        req.on("close", () => clearTimeout(deadline));
        req.on("error", () => resolve("unknown"));
        req.end(body);
      });
    },
  };
}

export function configuredResetSender(): ResetSender {
  const transport = process.env.PRAMAAN_PASSWORD_EMAIL_TRANSPORT ?? "module";
  if (transport === "module") return moduleResetSender();
  if (transport !== "capability") throw new Error("Choose capability or module for password email.");
  return capabilityResetSender(process.env.PRAMAAN_PASSWORD_EMAIL_FROM ?? (process.env.PRAMAAN_FAKE === "1" ? "account@example.com" : ""));
}
