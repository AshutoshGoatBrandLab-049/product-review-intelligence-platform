#!/usr/bin/env bash
# Restore gbl_data_lake."DataWarehouse" to the state captured at 2026-08-20 19:27:06
#
# Captured baseline (see BASELINE-counts.txt):
#   myntra_reviews        21647   (source)
#   flipkart_reviews       9086   (source, control - NOT restored by default)
#   normalized_reviews    25962   (9086 flipkart + 16876 myntra)
#   product_dimension       457
#   product_daily_metrics  4271
#   ingestion_watermarks      2   (myntra=52329, flipkart=17837)
#
# Usage:  ./RESTORE.sh            # restore myntra source + all canonical tables
#         ./RESTORE.sh --include-flipkart-source
#
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$DIR/../../backend/.env"
export PGPASSWORD="$(grep '^DB_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)"
PSQL=(psql -h localhost -U postgres -d gbl_data_lake -v ON_ERROR_STOP=1 -q)

TABLES=(myntra_reviews normalized_reviews product_dimension product_daily_metrics ingestion_watermarks)
if [[ "${1:-}" == "--include-flipkart-source" ]]; then
  TABLES=(flipkart_reviews "${TABLES[@]}")
fi

echo "Restoring: ${TABLES[*]}"

# Single transaction: truncate + reload, so a failure leaves the DB untouched.
{
  echo "BEGIN;"
  for T in "${TABLES[@]}"; do
    echo "TRUNCATE \"DataWarehouse\".$T;"
  done
  echo "COMMIT;"
} | "${PSQL[@]}"

for T in "${TABLES[@]}"; do
  "${PSQL[@]}" -c "\copy \"DataWarehouse\".$T FROM '$DIR/$T.csv' WITH (FORMAT csv, HEADER true)"
  echo "  restored $T"
done

echo ""
echo "=== Post-restore verification ==="
"${PSQL[@]}" -At -c "
SELECT 'myntra_reviews        '||COUNT(*) FROM \"DataWarehouse\".myntra_reviews
UNION ALL SELECT 'flipkart_reviews      '||COUNT(*) FROM \"DataWarehouse\".flipkart_reviews
UNION ALL SELECT 'normalized_reviews    '||COUNT(*) FROM \"DataWarehouse\".normalized_reviews
UNION ALL SELECT 'product_dimension     '||COUNT(*) FROM \"DataWarehouse\".product_dimension
UNION ALL SELECT 'product_daily_metrics '||COUNT(*) FROM \"DataWarehouse\".product_daily_metrics
UNION ALL SELECT 'ingestion_watermarks  '||COUNT(*) FROM \"DataWarehouse\".ingestion_watermarks;"
echo ""
echo "Compare against BASELINE-counts.txt"
