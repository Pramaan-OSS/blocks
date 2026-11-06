-- Apply before serving the block, after crm_listings_001.sql. Idempotent on an existing app database.
-- One row per application, status change and owner message.
CREATE TABLE IF NOT EXISTS crm_application (
  scope text NOT NULL,
  id uuid NOT NULL,
  listing_id uuid NOT NULL,
  applicant text NOT NULL CHECK (length(applicant) BETWEEN 1 AND 200),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  message text NOT NULL CHECK (length(message) BETWEEN 1 AND 4000),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'shortlisted', 'declined', 'accepted')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  file jsonb CHECK (file IS NULL OR jsonb_typeof(file) = 'object'),
  pending_file text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, id),
  -- One application per person and listing, and never across communities.
  UNIQUE (scope, listing_id, applicant),
  FOREIGN KEY (scope, listing_id) REFERENCES crm_listing (scope, id)
);
CREATE INDEX IF NOT EXISTS crm_application_own ON crm_application (scope, applicant, created_at DESC);

CREATE TABLE IF NOT EXISTS crm_application_event (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scope text NOT NULL,
  application_id uuid NOT NULL,
  from_status text CHECK (from_status IN ('new', 'shortlisted', 'declined', 'accepted')),
  to_status text NOT NULL CHECK (to_status IN ('new', 'shortlisted', 'declined', 'accepted')),
  actor text NOT NULL,
  at timestamptz NOT NULL,
  FOREIGN KEY (scope, application_id) REFERENCES crm_application (scope, id)
);
CREATE INDEX IF NOT EXISTS crm_application_event_history ON crm_application_event (scope, application_id, at);

CREATE TABLE IF NOT EXISTS crm_application_message (
  scope text NOT NULL,
  id uuid NOT NULL,
  application_id uuid NOT NULL,
  request_id uuid NOT NULL,
  author text NOT NULL,
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  -- The email that tells the applicant. Never the address.
  notice text NOT NULL DEFAULT 'pending' CHECK (notice IN ('pending', 'sent', 'not-sent', 'unknown')),
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, id),
  -- A repeated send of the same draft claims nothing, so it emails once.
  UNIQUE (scope, application_id, request_id),
  FOREIGN KEY (scope, application_id) REFERENCES crm_application (scope, id)
);
