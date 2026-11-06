-- Apply after crm_moderation_001.sql. Idempotent on an existing app database.
-- What the reviewer reads: a plain label and excerpt copied when the report is made, so a later edit or delete changes nothing.
ALTER TABLE crm_report ADD COLUMN IF NOT EXISTS subject jsonb CHECK (subject IS NULL OR jsonb_typeof(subject) = 'object');
