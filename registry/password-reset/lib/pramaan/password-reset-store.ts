import "server-only";
import type { ResetAccount, ResetProof, ResetStore } from "./password-reset";

type Row = { id: string; email: string; password_hash: string };
type QueryResult = { rows: Record<string, unknown>[] };
export interface ResetConnection {
  query(sql: string, values?: unknown[]): Promise<QueryResult>;
  release(): void;
}
export interface ResetPool {
  query(sql: string, values?: unknown[]): Promise<QueryResult>;
  connect(): Promise<ResetConnection>;
}
const account = (row?: Record<string, unknown>): ResetAccount | undefined => {
  const value = row as Row | undefined;
  return value?.email && value.password_hash ? { id: value.id, email: value.email, passwordHash: value.password_hash } : undefined;
};

/** Compatible with the kit's app_users and app_sessions tables and a pg Pool. */
export function postgresResetStore(pool: ResetPool): ResetStore {
  async function transaction<T>(work: (db: ResetConnection) => Promise<T>) {
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      const value = await work(db);
      await db.query("COMMIT");
      return value;
    } catch (error) { await db.query("ROLLBACK"); throw error; }
    finally { db.release(); }
  }
  async function replace(db: ResetConnection, id: string, hash: string) {
    await db.query("UPDATE app_users SET password_hash=$2 WHERE id=$1", [id, hash]);
    await db.query("DELETE FROM app_password_resets WHERE user_id=$1", [id]);
    await db.query("DELETE FROM app_sessions WHERE user_id=$1", [id]);
  }
  return {
    async find(email) { return account((await pool.query("SELECT id,email,password_hash FROM app_users WHERE lower(email)=$1", [email.toLowerCase()])).rows[0]); },
    async findById(id) { return account((await pool.query("SELECT id,email,password_hash FROM app_users WHERE id=$1", [id])).rows[0]); },
    async revoke(hash) { await pool.query("DELETE FROM app_password_resets WHERE token_hash=$1", [hash]); },
    async issue(proof) {
      await transaction(async (db) => {
        const user = account((await db.query("SELECT id,email,password_hash FROM app_users WHERE id=$1 FOR UPDATE", [proof.userId])).rows[0]);
        if (!user || user.passwordHash !== proof.passwordHash) return;
        await db.query("DELETE FROM app_password_resets WHERE user_id=$1", [proof.userId]);
        await db.query("INSERT INTO app_password_resets(token_hash,user_id,password_hash,expires_at) VALUES($1,$2,$3,to_timestamp($4 / 1000.0))", [proof.hash, proof.userId, proof.passwordHash, proof.expiresAt]);
      });
    },
    async redeem(hash, passwordHash, now) {
      return transaction(async (db) => {
        // Always lock the user first, just as issue/change do, avoiding opposite lock orders.
        const proof = (await db.query("SELECT user_id FROM app_password_resets WHERE token_hash=$1", [hash])).rows[0];
        if (!proof) return false;
        const user = account((await db.query("SELECT id,email,password_hash FROM app_users WHERE id=$1 FOR UPDATE", [proof.user_id])).rows[0]);
        if (!user) return false;
        const valid = (await db.query("SELECT token_hash FROM app_password_resets WHERE token_hash=$1 AND user_id=$2 AND password_hash=$3 AND expires_at>to_timestamp($4 / 1000.0)", [hash, user.id, user.passwordHash, now])).rows[0];
        if (!valid) return false;
        await replace(db, user.id, passwordHash);
        return true;
      });
    },
    async change(id, oldHash, passwordHash) {
      return transaction(async (db) => {
        const user = account((await db.query("SELECT id,email,password_hash FROM app_users WHERE id=$1 FOR UPDATE", [id])).rows[0]);
        if (!user || user.passwordHash !== oldHash) return false;
        await replace(db, id, passwordHash);
        return true;
      });
    },
  };
}

/** Fake storage only. No plaintext reset proofs are kept here. */
export function memoryResetStore() {
  const users = new Map<string, ResetAccount>();
  const proofs = new Map<string, ResetProof>();
  const sessions = new Map<string, string>();
  function replace(id: string, hash: string) {
    const user = users.get(id)!;
    user.passwordHash = hash;
    for (const [key, proof] of proofs) if (proof.userId === id) proofs.delete(key);
    for (const [key, userId] of sessions) if (userId === id) sessions.delete(key);
  }
  const store: ResetStore = {
    async find(email) { const user = [...users.values()].find((u) => u.email.toLowerCase() === email.toLowerCase()); return user && { ...user }; },
    async findById(id) { const user = users.get(id); return user && { ...user }; },
    async revoke(hash) { proofs.delete(hash); },
    async issue(proof) {
      if (users.get(proof.userId)?.passwordHash !== proof.passwordHash) return;
      for (const [key, row] of proofs) if (row.userId === proof.userId) proofs.delete(key);
      proofs.set(proof.hash, { ...proof });
    },
    async redeem(hash, passwordHash, now) {
      const proof = proofs.get(hash);
      if (!proof || proof.expiresAt <= now || users.get(proof.userId)?.passwordHash !== proof.passwordHash) return false;
      replace(proof.userId, passwordHash);
      return true;
    },
    async change(id, oldHash, passwordHash) {
      if (users.get(id)?.passwordHash !== oldHash) return false;
      replace(id, passwordHash);
      return true;
    },
  };
  return { store, users, proofs, sessions };
}
