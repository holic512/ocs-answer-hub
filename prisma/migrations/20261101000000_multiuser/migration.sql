-- 增量升级；沿用 administrators 保存已有账号/密码，不重建业务表。
BEGIN;
ALTER TABLE administrators DROP CONSTRAINT administrators_id_check;
CREATE SEQUENCE administrator_ids START 2;
SELECT setval('administrator_ids', greatest(coalesce((SELECT max(id) FROM administrators),1),1));
ALTER TABLE administrators ALTER COLUMN id SET DEFAULT nextval('administrator_ids');
ALTER TABLE administrators ADD COLUMN role text NOT NULL DEFAULT 'user' CHECK(role IN ('admin','user')),
 ADD COLUMN disabled boolean NOT NULL DEFAULT false,
 ADD COLUMN daily_limit int NOT NULL DEFAULT 2000 CHECK(daily_limit>=0),
 ADD COLUMN rpm int NOT NULL DEFAULT 60 CHECK(rpm>=1),
 ADD COLUMN usage_day date NOT NULL DEFAULT CURRENT_DATE,
 ADD COLUMN day_count int NOT NULL DEFAULT 0,
 ADD COLUMN minute_bucket timestamptz NOT NULL DEFAULT date_trunc('minute',now()),
 ADD COLUMN minute_count int NOT NULL DEFAULT 0;
UPDATE administrators SET role='admin',daily_limit=greatest(2000,coalesce((SELECT sum(day_count) FROM api_tokens WHERE usage_day=CURRENT_DATE),0)),day_count=coalesce((SELECT sum(day_count) FROM api_tokens WHERE usage_day=CURRENT_DATE),0) WHERE id=1;
ALTER TABLE sessions ADD COLUMN user_id int NOT NULL DEFAULT 1 REFERENCES administrators(id);
ALTER TABLE api_tokens ADD COLUMN user_id int NOT NULL DEFAULT 1 REFERENCES administrators(id);
ALTER TABLE query_events ADD COLUMN user_id int REFERENCES administrators(id);
UPDATE query_events SET user_id=1 WHERE EXISTS(SELECT 1 FROM administrators WHERE id=1);
CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE INDEX tokens_user_idx ON api_tokens(user_id);
CREATE INDEX events_user_date_idx ON query_events(user_id,created_at DESC);
COMMIT;
