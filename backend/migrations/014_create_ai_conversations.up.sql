-- Phase 10 Step 2 — Team-shared conversation persistence for AI Product Analyst.
-- Stores shared team investigation history with product context, messages, and AI analysis metadata.
-- One conversation per (platform, source_product_id, window_start, window_end) — shared across authorized team members.
-- created_by is audit metadata only, NOT an access control gate.
-- Messages stored as JSONB array for append-only pattern.

CREATE TABLE ai_product_analyst_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- PRODUCT CONTEXT — shared across team
  platform TEXT NOT NULL CHECK (platform IN ('flipkart','myntra')),
  source_product_id TEXT NOT NULL,
  window_start DATE NOT NULL,
  window_end DATE NOT NULL,

  -- AUDIT METADATA — informational only
  created_by TEXT,  -- user_id from JWT, for audit trail

  -- MESSAGES — team-visible investigation history
  messages JSONB NOT NULL DEFAULT '[]'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One conversation per product/window pair (not per user)
  UNIQUE (platform, source_product_id, window_start, window_end)
);

-- Index for conversation fetch by product/window
CREATE INDEX idx_ai_conversations_product_window ON ai_product_analyst_conversations
  (platform, source_product_id, window_start, window_end);
