-- Phase 10 Step 2 — Question cache for AI Product Analyst.
-- Caches validated AI responses for identical questions within the same product/window.
-- 30-day TTL prevents stale answers as underlying data changes.
-- Keyed on (platform, source_product_id, window_start, window_end, question_hash)
-- to prevent cross-product/window cache pollution.

CREATE TABLE ai_question_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL CHECK (platform IN ('flipkart','myntra')),
  source_product_id TEXT NOT NULL,
  window_start DATE NOT NULL,
  window_end DATE NOT NULL,
  question_hash CHAR(64) NOT NULL,
  question_text TEXT NOT NULL,

  -- Full validated ProductAnalystResponse, never raw model output
  result JSONB NOT NULL,

  model_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (platform, source_product_id, window_start, window_end, question_hash)
);

-- Index for cache lookups
CREATE INDEX idx_ai_question_cache_lookup
  ON ai_question_cache (platform, source_product_id, window_start, window_end, question_hash);

-- Index for cleanup of expired entries (>30 days old)
CREATE INDEX idx_ai_question_cache_created_at ON ai_question_cache (created_at);
