import { expect, it, vi } from "vitest";
import { memoryResetStore, postgresResetStore, type ResetPool } from "@/lib/pramaan/password-reset-store";

const user = { id: "8b6fb969-77ef-4015-b5a8-901faad12c89", email: "Sam@Example.com", password_hash: "current-hash" };
function stubPool(failAt?: string) {
  const statements: { sql: string; values?: unknown[] }[] = [];
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    statements.push({ sql, values });
    if (failAt && sql.includes(failAt)) throw new Error("Sample database error");
    if (sql.startsWith("SELECT id,email,password_hash")) return { rows: sql.includes("WHERE email=") ? [] : [user] };
    if (sql.startsWith("SELECT user_id")) return { rows: [{ user_id: user.id }] };
    if (sql.startsWith("SELECT token_hash")) return { rows: [{ token_hash: "a".repeat(64) }] };
    return { rows: [] };
  });
  const release = vi.fn();
  const pool: ResetPool = { query, connect: async () => ({ query, release }) };
  return { pool, statements, release };
}

it("5: looks up mixed-case stored addresses in both Postgres and the fake", async () => {
  const { pool, statements } = stubPool();
  expect((await postgresResetStore(pool).find("sam@example.com"))?.email).toBe("Sam@Example.com");
  expect(statements[0]).toEqual({ sql: "SELECT id,email,password_hash FROM app_users WHERE lower(email)=$1", values: ["sam@example.com"] });
  const memory = memoryResetStore();
  memory.users.set(user.id, { id: user.id, email: user.email, passwordHash: user.password_hash });
  expect((await memory.store.find("sam@example.com"))?.id).toBe(user.id);
});

it("5: locks the account before re-checking proof version and expiry, replacing and deleting within one transaction", async () => {
  const { pool, statements, release } = stubPool();
  expect(await postgresResetStore(pool).redeem("a".repeat(64), "new-hash", 12345)).toBe(true);
  const queries = statements.map((s) => s.sql);
  const lock = queries.findIndex((sql) => sql.includes("FOR UPDATE"));
  const proofCheck = queries.findIndex((sql) => sql.startsWith("SELECT token_hash"));
  expect(queries[0]).toBe("BEGIN"); expect(lock).toBeGreaterThan(0); expect(proofCheck).toBeGreaterThan(lock);
  expect(statements[proofCheck].values).toEqual(["a".repeat(64), user.id, "current-hash", 12345]);
  expect(queries[proofCheck]).toContain("password_hash=$3 AND expires_at>");
  expect(queries.slice(proofCheck + 1)).toEqual([
    "UPDATE app_users SET password_hash=$2 WHERE id=$1",
    "DELETE FROM app_password_resets WHERE user_id=$1",
    "DELETE FROM app_sessions WHERE user_id=$1", "COMMIT",
  ]);
  expect(release).toHaveBeenCalledOnce();
});

it("5: rolls back and releases the connection if any password or session write fails", async () => {
  for (const failAt of ["UPDATE app_users", "DELETE FROM app_password_resets", "DELETE FROM app_sessions"]) {
    const { pool, statements, release } = stubPool(failAt);
    await expect(postgresResetStore(pool).redeem("a".repeat(64), "new-hash", 12345)).rejects.toThrow("Sample database error");
    expect(statements.at(-1)?.sql).toBe("ROLLBACK");
    expect(statements.some((s) => s.sql === "COMMIT")).toBe(false);
    expect(release).toHaveBeenCalledOnce();
  }
});

it("5: issue and change use the same user-first lock order and revoke targets only its proof", async () => {
  const { pool, statements } = stubPool();
  const store = postgresResetStore(pool);
  await store.issue({ hash: "a".repeat(64), userId: user.id, passwordHash: "current-hash", expiresAt: 20000 });
  expect(statements[1].sql).toContain("FOR UPDATE");
  expect(statements[2].sql).toBe("DELETE FROM app_password_resets WHERE user_id=$1");
  statements.length = 0;
  expect(await store.change(user.id, "current-hash", "next-hash")).toBe(true);
  expect(statements[1].sql).toContain("FOR UPDATE");
  expect(statements.at(-1)?.sql).toBe("COMMIT");
  statements.length = 0;
  await store.revoke("a".repeat(64));
  expect(statements).toEqual([{ sql: "DELETE FROM app_password_resets WHERE token_hash=$1", values: ["a".repeat(64)] }]);
});
