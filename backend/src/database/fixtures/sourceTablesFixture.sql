-- Source-table fixture, SCHEMA-PARAMETERIZED.
--
-- Mirrors the VERIFIED shape of the two — and only two — source tables:
--   flipkart_reviews, myntra_reviews
-- DDL, indexes, constraints, defaults and data types were verified column-by-column
-- against the live gbl_data_lake."DataWarehouse" tables (2026-08-20).
--
-- Unlike the older per-marketplace fixtures (which hardcode "DataWarehouse" and a
-- separate pri_test_prodsource database), this file takes the schema as a psql
-- variable so the test environment can co-locate source + canonical tables in ONE
-- database and ONE schema — faithfully mirroring production, where the application
-- reaches every table through a single connection (config.appStore).
--
-- Usage:  psql -v schema=product_review_intelligence -f sourceTablesFixture.sql

CREATE SCHEMA IF NOT EXISTS :"schema";

-- ── Myntra ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS :"schema".myntra_reviews (
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

CREATE INDEX IF NOT EXISTS myntra_reviews_product_id
  ON :"schema".myntra_reviews (product_id);
CREATE INDEX IF NOT EXISTS idx_myntra_reviews_review_date
  ON :"schema".myntra_reviews (review_date);

-- ── Flipkart ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS :"schema".flipkart_reviews (
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

CREATE INDEX IF NOT EXISTS flipkart_reviews_pid
  ON :"schema".flipkart_reviews (pid);
CREATE INDEX IF NOT EXISTS flipkart_reviews_review_date
  ON :"schema".flipkart_reviews (review_date);
CREATE INDEX IF NOT EXISTS flipkart_reviews_pid_review_date
  ON :"schema".flipkart_reviews (pid, review_date);
