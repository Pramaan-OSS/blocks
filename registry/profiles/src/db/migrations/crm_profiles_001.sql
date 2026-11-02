-- Apply before serving the block. Idempotent on an existing app database. One row per profile.
CREATE TABLE IF NOT EXISTS crm_profile (
  scope text NOT NULL,
  person text NOT NULL CHECK (length(person) BETWEEN 1 AND 200),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  name text NOT NULL DEFAULT '' CHECK (length(name) <= 100),
  bio text NOT NULL DEFAULT '' CHECK (length(bio) <= 500),
  links jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(links) = 'array' AND jsonb_array_length(links) <= 5),
  photo jsonb CHECK (photo IS NULL OR jsonb_typeof(photo) = 'object'),
  pending_photo text,
  public_name boolean NOT NULL DEFAULT false,
  public_bio boolean NOT NULL DEFAULT false,
  public_links boolean NOT NULL DEFAULT false,
  public_photo boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, person)
);
