-- Extension intentionally left in place — it's DB-wide, not table-scoped,
-- and other migrations (ingestion_rejects) also depend on it.
DROP TABLE IF EXISTS identity_anomalies;
