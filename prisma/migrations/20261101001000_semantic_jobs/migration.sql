-- 服务器须先安装 pgvector 二进制；扩展缺失时整个迁移事务回滚，不损坏已有表。
BEGIN;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE TABLE background_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL CHECK(kind IN ('generation','backfill')),
 user_id int NOT NULL REFERENCES administrators(id), provider_id uuid, course text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','failed','cancelled')),
 max_rounds int NOT NULL DEFAULT 1 CHECK(max_rounds BETWEEN 1 AND 50), max_questions int NOT NULL DEFAULT 10 CHECK(max_questions BETWEEN 1 AND 500),
 batch_size int NOT NULL DEFAULT 10 CHECK(batch_size BETWEEN 1 AND 20), round int NOT NULL DEFAULT 0, accepted int NOT NULL DEFAULT 0,
 attempts int NOT NULL DEFAULT 0, max_attempts int NOT NULL DEFAULT 3 CHECK(max_attempts BETWEEN 1 AND 5),
 cancel_requested boolean NOT NULL DEFAULT false, lease_until timestamptz, lease_token uuid,
 cursor_id uuid, processed int NOT NULL DEFAULT 0, skipped_count int NOT NULL DEFAULT 0, error text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_claim_idx ON background_jobs(status,lease_until,created_at);
ALTER TABLE questions ADD COLUMN generation_task_id uuid REFERENCES background_jobs(id), ADD COLUMN generation_round int, ADD COLUMN generation_model text;
CREATE INDEX questions_generation_idx ON questions(generation_task_id);
CREATE TABLE question_vectors (
 question_id uuid PRIMARY KEY REFERENCES questions(id), embedding vector(512) NOT NULL, content_hash text NOT NULL, model text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX question_vector_hnsw_idx ON question_vectors USING hnsw(embedding vector_cosine_ops);
CREATE TABLE vector_index_skips (
 question_id uuid PRIMARY KEY REFERENCES questions(id), content_hash text NOT NULL, model text NOT NULL, reason text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE generation_previews (
 id bigserial PRIMARY KEY, job_id uuid NOT NULL REFERENCES background_jobs(id), round int NOT NULL,
 question_id uuid REFERENCES questions(id), data jsonb NOT NULL, status text NOT NULL, reason text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX generation_previews_job_idx ON generation_previews(job_id,id);
COMMIT;
