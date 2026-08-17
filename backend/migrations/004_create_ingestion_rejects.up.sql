CREATE TABLE ingestion_rejects (
  reject_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform            TEXT NOT NULL,
  source_row_id        BIGINT,
  source_product_id     TEXT,
  source_review_id       TEXT,
  reason                   TEXT NOT NULL,
  failed_fields             JSONB NOT NULL,
  first_seen_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  occurrence_count              INTEGER NOT NULL DEFAULT 1
);
