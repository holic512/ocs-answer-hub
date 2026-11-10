BEGIN;
ALTER TABLE administrators RENAME TO users;
ALTER TABLE users DROP COLUMN daily_limit, DROP COLUMN rpm, DROP COLUMN usage_day, DROP COLUMN day_count, DROP COLUMN minute_bucket, DROP COLUMN minute_count;
ALTER TABLE users ADD COLUMN deleted_at timestamptz, ADD COLUMN balance integer NOT NULL DEFAULT 0, ADD COLUMN frozen integer NOT NULL DEFAULT 0,
 ADD CONSTRAINT users_credit_check CHECK (balance >= 0 AND frozen >= 0 AND frozen <= balance);
ALTER TABLE questions DROP COLUMN source, DROP COLUMN verified, DROP COLUMN conflict, ADD COLUMN content_version integer NOT NULL DEFAULT 1;
ALTER TABLE answer_versions DROP COLUMN source, DROP COLUMN verified, ADD COLUMN operation text NOT NULL DEFAULT '历史修改', ADD COLUMN snapshot jsonb;
ALTER TABLE query_events ADD COLUMN token_name text, ADD COLUMN token_prefix text, ADD COLUMN billing_status text NOT NULL DEFAULT 'none' CHECK(billing_status IN ('none','held','charged','released')),
 ADD COLUMN billing_expires_at timestamptz;
UPDATE query_events e SET token_name=t.name,token_prefix=t.prefix FROM api_tokens t WHERE t.id=e.token_id;
CREATE TABLE credit_ledger (
 id bigserial PRIMARY KEY, user_id integer NOT NULL REFERENCES users(id), amount integer NOT NULL, balance integer NOT NULL,
 reason text NOT NULL, actor_id integer REFERENCES users(id), event_id bigint UNIQUE REFERENCES query_events(id), reference_key text UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now()
);
UPDATE users SET balance=20;
INSERT INTO credit_ledger(user_id,amount,balance,reason,reference_key) SELECT id,20,20,'系统升级赠送', 'upgrade:workspace:'||id FROM users;
ALTER TABLE question_vectors ADD COLUMN content_version integer NOT NULL DEFAULT 0;
ALTER TABLE vector_index_skips ADD COLUMN content_version integer NOT NULL DEFAULT 0;
ALTER TABLE background_jobs ADD COLUMN seed_snapshot jsonb NOT NULL DEFAULT '[]', ADD COLUMN schedule_id uuid;
CREATE TABLE task_schedules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, kind text NOT NULL CHECK(kind IN ('backfill','generation')),
 enabled boolean NOT NULL DEFAULT false, mode text NOT NULL DEFAULT 'interval' CHECK(mode IN ('interval','daily')),
 interval_minutes integer NOT NULL DEFAULT 5 CHECK(interval_minutes BETWEEN 1 AND 10080), time_of_day text NOT NULL DEFAULT '03:00',
 config jsonb NOT NULL DEFAULT '{}', next_run_at timestamptz NOT NULL DEFAULT now(), last_run_at timestamptz,
 user_id integer REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO task_schedules(name,kind,enabled) VALUES('向量增量维护','backfill',true);
UPDATE settings SET value=value || '{"registrationEnabled":true,"registrationCredits":20,"tokenDailyDefault":2000,"tokenRpmDefault":60,"tokenDailyMax":100000,"tokenRpmMax":600}'::jsonb WHERE id=1;
DELETE FROM providers WHERE kind <> 'ai';
ALTER TABLE providers DROP CONSTRAINT IF EXISTS providers_kind_check;
ALTER TABLE providers ADD CONSTRAINT providers_ai_only CHECK(kind='ai');
CREATE INDEX ledger_user_date_idx ON credit_ledger(user_id,created_at DESC,id DESC);
CREATE INDEX questions_partition_idx ON questions(course,type) WHERE NOT deleted;
CREATE INDEX questions_updated_idx ON questions(updated_at DESC,id) WHERE NOT deleted;
CREATE INDEX tokens_user_created_idx ON api_tokens(user_id,created_at DESC);
CREATE INDEX events_billing_expiry_idx ON query_events(billing_expires_at) WHERE billing_status='held';
CREATE INDEX schedules_due_idx ON task_schedules(next_run_at) WHERE enabled;
CREATE OR REPLACE FUNCTION bump_question_content_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.fingerprint,NEW.title,NEW.type,NEW.options,NEW.images,NEW.course,NEW.answer,NEW.deleted) IS DISTINCT FROM ROW(OLD.fingerprint,OLD.title,OLD.type,OLD.options,OLD.images,OLD.course,OLD.answer,OLD.deleted) THEN
  NEW.content_version=OLD.content_version+1;
  NEW.updated_at=now();
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER questions_content_version BEFORE UPDATE ON questions FOR EACH ROW EXECUTE FUNCTION bump_question_content_version();
COMMIT;
