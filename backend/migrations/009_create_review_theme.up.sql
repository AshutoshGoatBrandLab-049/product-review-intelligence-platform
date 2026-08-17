-- Phase 3 §11/§15: theme FOUNDATION only — schema for future AI extraction,
-- unused by any Phase 3 code. A review can have multiple themes, so this is
-- one row per (review, theme), not embedded on normalized_reviews.
CREATE TABLE review_theme (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_review_id       CHAR(32) NOT NULL REFERENCES normalized_reviews(canonical_review_id),
  theme                     TEXT NOT NULL CHECK (theme IN (
                               'quality','size','fit','comfort','color','durability',
                               'packaging','delivery','value','material','product_mismatch'
                             )),
  evidence_snippet          TEXT,
  confidence                REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  model_version              TEXT NOT NULL,
  extracted_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  content_hash_at_extraction   CHAR(64) NOT NULL,
  UNIQUE (canonical_review_id, theme)
);

CREATE INDEX idx_review_theme_canonical_review_id ON review_theme (canonical_review_id);
