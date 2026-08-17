-- Phase 4 §12: durable audit trail for AI processing batches — the AI
-- layer's equivalent of ingestion observability. Justified as a persisted
-- table (unlike Phase 3's rebuild, which only logs) because AI calls cost
-- real money and need a queryable history, not just console output.
CREATE TABLE ai_processing_runs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id             TEXT NOT NULL,
  platform           TEXT, -- NULL = ran across all platforms
  provider           TEXT NOT NULL,
  model_version      TEXT NOT NULL,
  dry_run            BOOLEAN NOT NULL DEFAULT false,
  candidate_count    INTEGER NOT NULL DEFAULT 0,
  already_classified_count INTEGER NOT NULL DEFAULT 0,
  stale_count        INTEGER NOT NULL DEFAULT 0,
  new_count          INTEGER NOT NULL DEFAULT 0,
  processed_count    INTEGER NOT NULL DEFAULT 0,
  success_count      INTEGER NOT NULL DEFAULT 0,
  failure_count      INTEGER NOT NULL DEFAULT 0,
  retry_count        INTEGER NOT NULL DEFAULT 0,
  started_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at        TIMESTAMPTZ,
  duration_ms        INTEGER,
  status             TEXT NOT NULL CHECK (status IN ('running','success','partial_failure','failed'))
);

CREATE INDEX idx_ai_processing_runs_job_id ON ai_processing_runs (job_id);
