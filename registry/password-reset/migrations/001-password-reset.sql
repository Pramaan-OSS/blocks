-- Apply after the local account tables. No plaintext reset proof is stored.
CREATE TABLE IF NOT EXISTS app_password_resets (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS app_password_resets_user ON app_password_resets(user_id);
CREATE INDEX IF NOT EXISTS app_password_resets_expiry ON app_password_resets(expires_at);
