import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { expect, it } from "vitest";
import { postgresResetStore } from "@/lib/pramaan/password-reset-store";

// Explicit opt-in only. Refuse nonlocal databases and create/drop only a unique test schema.
it.skipIf(process.env.PRAMAAN_PASSWORD_RESET_PG_TEST !== "1")("5: real Postgres permits one concurrent redemption and rolls back incomplete changes", async () => {
  const connectionString = process.env.PRAMAAN_PASSWORD_RESET_PG_URL;
  if (!connectionString) throw new Error("Provide a local password-reset test database.");
  const url = new URL(connectionString);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Password tests require a local database.");
  const schema = `reset_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString });
  const pool = new Pool({ connectionString, options: `-c search_path=${schema}`, max: 4 });
  const id = randomUUID(); const token = "a".repeat(64); const now = Date.now();
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await pool.query("CREATE TABLE app_users (id uuid PRIMARY KEY, email text NOT NULL, password_hash text NOT NULL); CREATE TABLE app_sessions (token_hash text PRIMARY KEY, user_id uuid REFERENCES app_users(id))");
    await pool.query(await readFile(new URL("../registry/password-reset/migrations/001-password-reset.sql", import.meta.url), "utf8"));
    const store = postgresResetStore(pool);
    await pool.query("INSERT INTO app_users VALUES($1,$2,$3)", [id, "Sam@Example.com", "old-hash"]);
    expect((await store.find("sam@example.com"))?.id).toBe(id);
    await pool.query("INSERT INTO app_sessions VALUES('sample-session',$1)", [id]);
    await store.issue({ hash: token, userId: id, passwordHash: "old-hash", expiresAt: now + 60000 });
    expect((await Promise.all([store.redeem(token, "first-hash", now), store.redeem(token, "second-hash", now)])).sort()).toEqual([false, true]);
    expect((await pool.query("SELECT * FROM app_password_resets")).rowCount).toBe(0);
    expect((await pool.query("SELECT * FROM app_sessions")).rowCount).toBe(0);
    const hash = (await store.findById(id))!.passwordHash;
    // Exact scalar values catch accidental JSON encoding of text columns.
    expect(["first-hash", "second-hash"]).toContain(hash);
    await store.issue({ hash: token, userId: id, passwordHash: hash, expiresAt: now });
    expect(await store.redeem(token, "expired-must-not-save", now)).toBe(false);
    await store.revoke("b".repeat(64));
    expect((await pool.query("SELECT * FROM app_password_resets")).rowCount).toBe(1);
    await store.revoke(token);
    expect((await pool.query("SELECT * FROM app_password_resets")).rowCount).toBe(0);
    await store.issue({ hash: token, userId: id, passwordHash: hash, expiresAt: now + 60000 });
    await pool.query("INSERT INTO app_sessions VALUES('sample-session',$1)", [id]);
    expect(await store.change(id, "wrong-old-hash", "must-not-save")).toBe(false);
    expect((await pool.query("SELECT * FROM app_password_resets")).rowCount).toBe(1);
    expect(await store.change(id, hash, "changed-hash")).toBe(true);
    expect((await store.findById(id))?.passwordHash).toBe("changed-hash");
    expect((await pool.query("SELECT * FROM app_password_resets")).rowCount).toBe(0);
    expect((await pool.query("SELECT * FROM app_sessions")).rowCount).toBe(0);
    await store.issue({ hash: token, userId: id, passwordHash: "changed-hash", expiresAt: now + 60000 });
    await pool.query("UPDATE app_users SET password_hash='out-of-band-change' WHERE id=$1", [id]);
    expect(await store.redeem(token, "must-not-save", now)).toBe(false);
    await store.issue({ hash: token, userId: id, passwordHash: "out-of-band-change", expiresAt: now + 60000 });
    await pool.query("INSERT INTO app_sessions VALUES('sample-session',$1)", [id]);
    await pool.query("CREATE FUNCTION refuse_session_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'sample failure'; END $$; CREATE TRIGGER refuse_session_delete BEFORE DELETE ON app_sessions FOR EACH ROW EXECUTE FUNCTION refuse_session_delete()");
    await expect(store.redeem(token, "must-roll-back", now)).rejects.toThrow("sample failure");
    expect((await store.findById(id))?.passwordHash).toBe("out-of-band-change");
    expect((await pool.query("SELECT * FROM app_password_resets")).rowCount).toBe(1);
    expect((await pool.query("SELECT * FROM app_sessions")).rowCount).toBe(1);
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
}, 20000);
