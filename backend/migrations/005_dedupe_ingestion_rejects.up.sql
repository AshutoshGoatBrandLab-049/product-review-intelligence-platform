-- Phase 2.1 §2: Track B previously created a brand-new ingestion_rejects row
-- on every reconciliation pass for the same persistently-invalid source row.
-- This migration (a) consolidates any pre-existing duplicates produced by
-- that behavior into one row per (platform, source_row_id, reason), summing
-- occurrence_count and preserving the earliest first_seen_at / latest
-- last_seen_at, then (b) makes that identity structurally unique going
-- forward so the application-level upsert in rejectRecorder.ts can never be
-- bypassed by a future bug reintroducing duplicate inserts.
--
-- Identity is (platform, source_row_id, reason) — never review text, never
-- timestamps, never a fresh UUID per observation (Phase 2.1 §2C). A source
-- row that starts failing for a *different* reason gets its own row, tracked
-- independently — see the report for why that's the correct behavior, not a
-- gap.

WITH grouped AS (
  SELECT
    platform,
    source_row_id,
    reason,
    min(first_seen_at) AS first_seen_at,
    max(last_seen_at) AS last_seen_at,
    sum(occurrence_count) AS occurrence_count,
    (array_agg(reject_id ORDER BY last_seen_at DESC))[1] AS keep_reject_id,
    (array_agg(failed_fields ORDER BY last_seen_at DESC))[1] AS latest_failed_fields
  FROM ingestion_rejects
  WHERE source_row_id IS NOT NULL
  GROUP BY platform, source_row_id, reason
  HAVING count(*) > 1
)
UPDATE ingestion_rejects r
SET first_seen_at = g.first_seen_at,
    last_seen_at = g.last_seen_at,
    occurrence_count = g.occurrence_count,
    failed_fields = g.latest_failed_fields
FROM grouped g
WHERE r.reject_id = g.keep_reject_id;

DELETE FROM ingestion_rejects r
USING (
  SELECT
    reject_id,
    row_number() OVER (
      PARTITION BY platform, source_row_id, reason
      ORDER BY last_seen_at DESC
    ) AS rn
  FROM ingestion_rejects
  WHERE source_row_id IS NOT NULL
) ranked
WHERE r.reject_id = ranked.reject_id AND ranked.rn > 1;

-- Any pre-existing NULL source_row_id rows (none expected from current
-- application code, which always populates it) would block the NOT NULL
-- below — fail loudly rather than silently drop them.
ALTER TABLE ingestion_rejects ALTER COLUMN source_row_id SET NOT NULL;

ALTER TABLE ingestion_rejects
  ADD CONSTRAINT ingestion_rejects_platform_source_row_reason_key
  UNIQUE (platform, source_row_id, reason);
