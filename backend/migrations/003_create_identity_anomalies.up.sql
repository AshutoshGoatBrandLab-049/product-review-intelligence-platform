-- app store only, for gen_random_uuid(); idempotent, DB-wide (not schema-scoped)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE identity_anomalies (
  anomaly_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_review_id     CHAR(32) NOT NULL REFERENCES normalized_reviews(canonical_review_id),
  platform                 TEXT NOT NULL,
  previous_content_hash     CHAR(64) NOT NULL,
  new_content_hash           CHAR(64) NOT NULL,
  detected_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);
