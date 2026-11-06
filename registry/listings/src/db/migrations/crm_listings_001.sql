-- Apply before serving the block, after crm_moderation_001.sql. Idempotent on an existing app database.
-- One row per listing. Search uses the generated text column; hidden and blocked rows are filtered in each query.
CREATE TABLE IF NOT EXISTS crm_listing (
  scope text NOT NULL,
  id uuid NOT NULL,
  owner text NOT NULL CHECK (length(owner) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  description text NOT NULL CHECK (length(description) BETWEEN 1 AND 5000),
  category text NOT NULL CHECK (length(category) BETWEEN 1 AND 50),
  price_text text NOT NULL DEFAULT '' CHECK (length(price_text) <= 60),
  price numeric(14, 2) CHECK (price >= 0),
  location text NOT NULL DEFAULT '' CHECK (length(location) <= 120),
  place text,
  latitude double precision,
  longitude double precision,
  photos jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(photos) = 'array' AND jsonb_array_length(photos) <= 6),
  pending_photo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  search tsvector GENERATED ALWAYS AS (to_tsvector('english'::regconfig, title || ' ' || description || ' ' || category)) STORED,
  PRIMARY KEY (scope, id)
);
CREATE INDEX IF NOT EXISTS crm_listing_browse ON crm_listing (scope, status, created_at DESC, id);
CREATE INDEX IF NOT EXISTS crm_listing_owner ON crm_listing (scope, owner, created_at DESC);
CREATE INDEX IF NOT EXISTS crm_listing_search ON crm_listing USING gin (search);
