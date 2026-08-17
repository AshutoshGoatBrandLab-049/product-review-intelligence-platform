-- Phase 3 §8/§17: deterministic product identity + brand labeling.
-- Fully rebuilt from normalized_reviews on every analytics rebuild — never
-- hand-edited, never a source of truth in itself.
CREATE TABLE product_dimension (
  platform            TEXT NOT NULL CHECK (platform IN ('flipkart','myntra')),
  source_product_id   TEXT NOT NULL,
  brand               TEXT,
  brand_inconsistent  BOOLEAN NOT NULL DEFAULT false,
  product_url         TEXT,
  first_review_date   DATE NOT NULL,
  last_review_date    DATE NOT NULL,
  total_review_count  INTEGER NOT NULL,
  last_rebuilt_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (platform, source_product_id)
);
