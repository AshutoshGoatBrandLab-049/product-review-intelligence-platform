-- Phase 5 Step 6: the sole persisted table this sub-phase introduces, and the
-- only justified exception to Phase 3/4's "everything computed on demand,
-- nothing persisted" pattern — because there is no join key between Flipkart
-- pid and Myntra product_id (§15), a mapping cannot be computed from existing
-- data at all; it can only ever be reference data. Starts EMPTY — no
-- fuzzy-matching, no auto-population, no business-provided data exists yet.
-- Each platform-specific product ID may belong to at most one family.
CREATE TABLE product_family_mapping (
  family_id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flipkart_source_product_id   TEXT NOT NULL UNIQUE,
  myntra_source_product_id     TEXT NOT NULL UNIQUE,
  notes                        TEXT,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);
