import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { capabilityResetSender, configuredResetSender, moduleResetSender } from "@/lib/pramaan/password-reset-sender";
import { fakeState, resetFake } from "@/lib/pramaan/fake";

const mail = { to: "sam@example.com", subject: "Reset your password", text: "A sample message" };
it("defaults to the private module, refuses capability delivery and rejects unknown settings", async () => {
  resetFake();
  vi.stubEnv("PRAMAAN_PASSWORD_EMAIL_TRANSPORT", undefined);
  expect(await configuredResetSender().send(mail, "sample-event")).toBe("not-sent");
  expect(fakeState().requests).toHaveLength(0);
  vi.stubEnv("PRAMAAN_PASSWORD_EMAIL_TRANSPORT", "capability");
  expect(await configuredResetSender().send(mail, "sample-event")).toBe("not-sent");
  const count = fakeState().requests.length;
  expect(await capabilityResetSender("").send(mail, "sample-event")).toBe("not-sent");
  expect(fakeState().requests).toHaveLength(count);
  vi.stubEnv("PRAMAAN_PASSWORD_EMAIL_TRANSPORT", "other");
  expect(() => configuredResetSender()).toThrow();
  vi.stubEnv("PRAMAAN_PASSWORD_EMAIL_TRANSPORT", "module");
});

it("uses the kit socket contract, keeps event keys and never returns upstream details", async () => {
  await mkdir(".scratch", { recursive: true });
  const directory = await mkdtemp(path.resolve(".scratch/mail-"));
  await writeFile(path.join(directory, "token"), "sample-module-token");
  let status = 202;
  const calls: { route?: string; key?: string; body: unknown }[] = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const part of req) chunks.push(part);
    calls.push({ route: req.url, key: req.headers["idempotency-key"] as string, body: JSON.parse(Buffer.concat(chunks).toString()) });
    expect(req.headers.authorization).toBe("Bearer sample-module-token");
    res.writeHead(status); res.end('{"message":"Private transport details"}');
  });
  await new Promise<void>((resolve) => server.listen(path.join(directory, "modules.sock"), resolve));
  try {
    const sender = moduleResetSender(directory);
    expect(await sender.send(mail, "same-event")).toBe("accepted");
    status = 503; expect(await sender.send(mail, "same-event")).toBe("not-sent");
    status = 504; expect(await sender.send(mail, "same-event")).toBe("unknown");
    expect(calls).toEqual(Array.from({ length: 3 }, () => ({ route: "/v1/email", key: "same-event", body: mail })));
    vi.stubEnv("PRAMAAN_PASSWORD_EMAIL_TRANSPORT", "module");
    expect(await configuredResetSender().send(mail, "no-door")).toBe("not-sent");
  } finally {
    vi.stubEnv("PRAMAAN_PASSWORD_EMAIL_TRANSPORT", "module");
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
