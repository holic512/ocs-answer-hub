BEGIN;
ALTER TABLE query_events
 ADD COLUMN fingerprint text,
 ADD COLUMN question_snapshot jsonb,
 ADD COLUMN request_id text,
 ADD COLUMN query_id text,
 ADD COLUMN failure_code text;
CREATE INDEX events_fingerprint_date_idx ON query_events(fingerprint,created_at DESC);
COMMIT;
