-- Apply before serving the block. Idempotent on an existing app database.
-- One row per report, block, hidden item and decision.
CREATE TABLE IF NOT EXISTS crm_report (
  id uuid PRIMARY KEY,
  scope text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('item', 'person')),
  ref text NOT NULL CHECK (length(ref) BETWEEN 1 AND 200),
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 1000),
  reported_by text NOT NULL,
  reported_at timestamptz NOT NULL DEFAULT now(),
  automatic boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'hidden', 'dismissed')),
  decided_by text,
  decided_at timestamptz,
  CHECK ((status = 'open') = (decided_by IS NULL AND decided_at IS NULL)),
  CHECK (status <> 'hidden' OR kind = 'item')
);
-- One open report per reporter and target; reviewed reports do not block a new one.
CREATE UNIQUE INDEX IF NOT EXISTS crm_report_open_once ON crm_report (scope, reported_by, kind, ref) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS crm_report_queue ON crm_report (scope, reported_at DESC);

CREATE TABLE IF NOT EXISTS crm_block (
  scope text NOT NULL,
  viewer text NOT NULL,
  other text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, viewer, other),
  CHECK (viewer <> other)
);

CREATE TABLE IF NOT EXISTS crm_hidden_item (
  scope text NOT NULL,
  ref text NOT NULL,
  hidden_by text NOT NULL,
  hidden_at timestamptz NOT NULL,
  PRIMARY KEY (scope, ref)
);

CREATE TABLE IF NOT EXISTS crm_moderation_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scope text NOT NULL,
  report_id uuid NOT NULL REFERENCES crm_report (id),
  action text NOT NULL CHECK (action IN ('hide', 'dismiss')),
  actor text NOT NULL,
  at timestamptz NOT NULL,
  kind text NOT NULL,
  ref text NOT NULL
);
CREATE INDEX IF NOT EXISTS crm_moderation_audit_recent ON crm_moderation_audit (scope, at DESC);
