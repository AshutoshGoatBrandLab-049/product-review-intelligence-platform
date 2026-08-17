ALTER TABLE ingestion_rejects DROP CONSTRAINT IF EXISTS ingestion_rejects_platform_source_row_reason_key;
ALTER TABLE ingestion_rejects ALTER COLUMN source_row_id DROP NOT NULL;
