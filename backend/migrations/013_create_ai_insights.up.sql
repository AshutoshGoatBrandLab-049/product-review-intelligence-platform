-- Phase 6 Step 2: the only new persisted table this phase introduces
-- (explicitly approved — see phase-6-api-architecture-design.md §4). Caches
-- the validated narrator result for GET /v1/products/:platform/:id/insights
-- so a repeated request for unchanged evidence never re-calls the AI
-- provider. Keyed on (platform, source_product_id, window_start, window_end,
-- input_hash) — input_hash is a deterministic hash of the evidence package
-- content, so any real change to the underlying data (new reviews, changed
-- sentiment/theme classification) produces a different key and a fresh
-- narration, never a stale cached answer silently reused.
--
-- Stores ONLY validated narrator output (post schema-check, post
-- citation-validity/relevance filtering, post numeric-claim-grounding
-- check) — never raw/unvalidated model output.
CREATE TABLE ai_insights (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform            TEXT NOT NULL CHECK (platform IN ('flipkart','myntra')),
  source_product_id   TEXT NOT NULL,
  window_start        DATE NOT NULL,
  window_end          DATE NOT NULL,
  input_hash          CHAR(64) NOT NULL,
  result              JSONB NOT NULL,
  model_version       TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (platform, source_product_id, window_start, window_end, input_hash)
);
-- No separate lookup index needed: the UNIQUE constraint above already
-- creates one covering exactly this cache-key lookup shape.
