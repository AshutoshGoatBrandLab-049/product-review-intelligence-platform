CREATE TABLE normalized_reviews (
  canonical_review_id    CHAR(32) PRIMARY KEY,
  platform                TEXT NOT NULL CHECK (platform IN ('flipkart','myntra')),
  source_product_id        TEXT NOT NULL,
  source_review_id          TEXT NOT NULL,
  source_row_id              BIGINT NOT NULL,
  identity_confidence         TEXT NOT NULL CHECK (identity_confidence IN ('native','derived')),
  brand                        TEXT,
  rating                        SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title                         TEXT,
  review_text                    TEXT,
  review_date                     DATE NOT NULL,
  review_timestamp                  TIMESTAMPTZ,
  date_confidence                    TEXT NOT NULL CHECK (date_confidence IN ('exact','day','month')),
  author                              TEXT,
  helpful_count                       INTEGER,
  not_helpful_count                    INTEGER,
  verified_purchase                     BOOLEAN,
  has_images                             BOOLEAN,
  image_urls                              TEXT[],
  size_purchased                           TEXT,
  color_purchased                           TEXT,
  country                                    TEXT,
  product_url                                 TEXT,
  content_hash                                 CHAR(64) NOT NULL,
  source_updated_at                             TIMESTAMPTZ NOT NULL,
  source_extra                                   JSONB,
  mapper_version                                  INTEGER NOT NULL,
  ingested_at                                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at                                        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                                         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (platform, source_product_id, source_review_id)
);

CREATE INDEX idx_normalized_reviews_platform_product
  ON normalized_reviews (platform, source_product_id);

CREATE INDEX idx_normalized_reviews_review_date
  ON normalized_reviews (review_date);
