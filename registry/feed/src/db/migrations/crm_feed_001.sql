-- Apply after the profiles and moderation migrations. Idempotent on an existing app database.
-- One row per post, like, comment, follow and unfinished photo upload.
CREATE TABLE IF NOT EXISTS crm_post (
  id uuid PRIMARY KEY,
  seq bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  scope text NOT NULL,
  author text NOT NULL CHECK (length(author) BETWEEN 1 AND 200),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  photos jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(photos) = 'array' AND jsonb_array_length(photos) <= 4),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz
);
CREATE INDEX IF NOT EXISTS crm_post_by_author ON crm_post (scope, author, seq DESC);

CREATE TABLE IF NOT EXISTS crm_post_like (
  post_id uuid NOT NULL REFERENCES crm_post (id) ON DELETE CASCADE,
  person text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, person)
);

CREATE TABLE IF NOT EXISTS crm_comment (
  id uuid PRIMARY KEY,
  seq bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  scope text NOT NULL,
  post_id uuid NOT NULL REFERENCES crm_post (id) ON DELETE CASCADE,
  author text NOT NULL CHECK (length(author) BETWEEN 1 AND 200),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz
);
CREATE INDEX IF NOT EXISTS crm_comment_by_post ON crm_comment (post_id, seq DESC);

CREATE TABLE IF NOT EXISTS crm_follow (
  scope text NOT NULL,
  follower text NOT NULL,
  followed text NOT NULL CHECK (length(followed) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, follower, followed),
  CHECK (follower <> followed)
);

-- Binds a photo upload to the person who started it, until a post claims it.
CREATE TABLE IF NOT EXISTS crm_feed_upload (
  scope text NOT NULL,
  file_id text NOT NULL,
  person text NOT NULL,
  file jsonb CHECK (file IS NULL OR jsonb_typeof(file) = 'object'),
  started_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, file_id)
);
CREATE INDEX IF NOT EXISTS crm_feed_upload_started ON crm_feed_upload (started_at);
