-- Phase 3 §9/§17/§18: daily-grain precomputed aggregate — the single table
-- every requested rollup (7d/30d/60d/90d/6m/12m windows; product/brand/
-- platform/combined) is built from via SUM, so the dashboard never scans
-- the full normalized_reviews table. Fully rebuilt from normalized_reviews
-- on every analytics rebuild.
CREATE TABLE product_daily_metrics (
  platform            TEXT NOT NULL CHECK (platform IN ('flipkart','myntra')),
  source_product_id   TEXT NOT NULL,
  review_date         DATE NOT NULL,
  review_count        INTEGER NOT NULL,
  rating_sum          INTEGER NOT NULL,
  rating_1_count      INTEGER NOT NULL DEFAULT 0,
  rating_2_count      INTEGER NOT NULL DEFAULT 0,
  rating_3_count      INTEGER NOT NULL DEFAULT 0,
  rating_4_count      INTEGER NOT NULL DEFAULT 0,
  rating_5_count      INTEGER NOT NULL DEFAULT 0,
  positive_count      INTEGER NOT NULL DEFAULT 0, -- 4-5 star
  negative_count      INTEGER NOT NULL DEFAULT 0, -- 1-2 star
  neutral_count       INTEGER NOT NULL DEFAULT 0, -- 3 star
  helpful_count_sum   INTEGER NOT NULL DEFAULT 0,
  last_rebuilt_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (platform, source_product_id, review_date)
);

-- Approved indexes (Phase 3 "LATEST 30 DAYS" section): a pure date-range
-- rollup across all products, and the product+date-range path. The primary
-- key already covers (platform, source_product_id, review_date) as a
-- leftmost prefix, but a standalone review_date index is what makes
-- "all products in the last 30 days" (no platform/product filter) fast.
CREATE INDEX idx_product_daily_metrics_review_date ON product_daily_metrics (review_date);
CREATE INDEX idx_product_daily_metrics_platform_product_date ON product_daily_metrics (platform, source_product_id, review_date);
