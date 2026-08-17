-- Local fixture mirroring the VERIFIED shape of DataWarehouse.flipkart_reviews
-- (flipkart-product-crawler/src/models/review.js). Used only in an isolated
-- test database (pri_test_prodsource) — never the real gbl_data_lake.
CREATE SCHEMA IF NOT EXISTS "DataWarehouse";

CREATE TABLE IF NOT EXISTS "DataWarehouse".flipkart_reviews (
  id                  SERIAL PRIMARY KEY,
  brand_name          VARCHAR,
  pid                 VARCHAR NOT NULL,
  review_id           VARCHAR(30) NOT NULL,
  rating              INTEGER NOT NULL,
  title               VARCHAR,
  comment             TEXT,
  review_date         DATE NOT NULL,
  product_url         TEXT,
  author_name         VARCHAR,
  verified_purchase   BOOLEAN DEFAULT false,
  helpful_count       INTEGER DEFAULT 0,
  country             VARCHAR,
  "createdAt"         TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pid, review_id)
);

CREATE INDEX IF NOT EXISTS flipkart_reviews_pid ON "DataWarehouse".flipkart_reviews (pid);
CREATE INDEX IF NOT EXISTS flipkart_reviews_review_date ON "DataWarehouse".flipkart_reviews (review_date);
CREATE INDEX IF NOT EXISTS flipkart_reviews_pid_review_date ON "DataWarehouse".flipkart_reviews (pid, review_date);
