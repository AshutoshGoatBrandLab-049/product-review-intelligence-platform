-- Phase 4: measured via EXPLAIN ANALYZE that AI candidate selection's
-- keyset pagination (WHERE platform = X ORDER BY canonical_review_id) had
-- no supporting index — it fell back to a full PK index scan filtered by
-- platform afterward (10,471 buffer reads for one 100-row page at 100K
-- total rows). This index serves that exact access pattern directly.
CREATE INDEX idx_normalized_reviews_platform_canonical_id
  ON normalized_reviews (platform, canonical_review_id);
