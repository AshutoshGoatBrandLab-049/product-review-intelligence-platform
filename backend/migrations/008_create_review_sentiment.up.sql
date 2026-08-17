-- Phase 3 §10/§15: sentiment FOUNDATION only — schema for future AI
-- classification, unused by any Phase 3 code. No row is ever written here in
-- Phase 3; no LLM call exists anywhere in this codebase yet.
CREATE TABLE review_sentiment (
  canonical_review_id            CHAR(32) PRIMARY KEY REFERENCES normalized_reviews(canonical_review_id),
  label                          TEXT NOT NULL CHECK (label IN ('positive','neutral','negative')),
  confidence                     REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  model_version                  TEXT NOT NULL,
  classified_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  content_hash_at_classification CHAR(64) NOT NULL
);
