-- Local fixture mirroring the VERIFIED shape of DataWarehouse.myntra_reviews
-- (myntra-product-crawler/src/models/review.js). Used only in an isolated
-- test database (pri_test_prodsource) — never the real gbl_data_lake.
CREATE SCHEMA IF NOT EXISTS "DataWarehouse";

CREATE TABLE IF NOT EXISTS "DataWarehouse".myntra_reviews (
  id                  SERIAL PRIMARY KEY,
  product_id          INTEGER NOT NULL,
  brand_name          TEXT NOT NULL,
  review_id           TEXT NOT NULL,
  rating              SMALLINT NOT NULL,
  title               TEXT,
  body                TEXT,
  review_date         DATE NOT NULL,
  reviewed_at         TIMESTAMPTZ,
  author_name         TEXT,
  helpful_count       INTEGER DEFAULT 0,
  not_helpful_count   INTEGER DEFAULT 0,
  has_images          BOOLEAN DEFAULT false,
  image_urls          TEXT[],
  size_purchased      TEXT,
  color_purchased     TEXT,
  product_url         TEXT,
  country             TEXT DEFAULT 'India',
  "createdAt"         TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, review_id)
);

CREATE INDEX IF NOT EXISTS myntra_reviews_product_id ON "DataWarehouse".myntra_reviews (product_id);
CREATE INDEX IF NOT EXISTS idx_myntra_reviews_review_date ON "DataWarehouse".myntra_reviews (review_date);
