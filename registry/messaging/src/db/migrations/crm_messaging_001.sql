-- Apply after the profiles and moderation migrations. Idempotent on an existing app database.
-- One row per one-to-one conversation and per message. person_a sorts before person_b in the app.
CREATE TABLE IF NOT EXISTS crm_conversation (
  id uuid PRIMARY KEY,
  scope text NOT NULL,
  person_a text NOT NULL CHECK (length(person_a) BETWEEN 1 AND 200),
  person_b text NOT NULL CHECK (length(person_b) BETWEEN 1 AND 200),
  started_by text NOT NULL,
  read_a bigint NOT NULL DEFAULT 0,
  read_b bigint NOT NULL DEFAULT 0,
  last_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope, person_a, person_b),
  CHECK (person_a <> person_b),
  CHECK (started_by IN (person_a, person_b))
);
CREATE INDEX IF NOT EXISTS crm_conversation_a ON crm_conversation (scope, person_a, last_at DESC);
CREATE INDEX IF NOT EXISTS crm_conversation_b ON crm_conversation (scope, person_b, last_at DESC);

CREATE TABLE IF NOT EXISTS crm_message (
  id uuid PRIMARY KEY,
  seq bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  scope text NOT NULL,
  conversation_id uuid NOT NULL REFERENCES crm_conversation (id) ON DELETE CASCADE,
  sender text NOT NULL,
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_message_by_conversation ON crm_message (conversation_id, seq DESC);
