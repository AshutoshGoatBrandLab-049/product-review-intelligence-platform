CREATE TABLE ingestion_watermarks (
  platform                          TEXT PRIMARY KEY CHECK (platform IN ('flipkart','myntra')),
  last_seen_source_id               BIGINT NOT NULL DEFAULT 0,
  last_reconciliation_run_at        TIMESTAMPTZ,
  last_reconciliation_rows_scanned  INTEGER,
  last_reconciliation_rows_changed  INTEGER,
  status                            TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle','running')),
  lock_acquired_at                  TIMESTAMPTZ,
  updated_at                        TIMESTAMPTZ NOT NULL DEFAULT now()
);
