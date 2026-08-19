# STEP 6 INVESTIGATION: Average Rating Discrepancy

**Date:** 2026-08-19  
**Product Investigated:** FKPID000457 (Flipkart)  
**Status:** DISCREPANCY CONFIRMED  
**Severity:** CRITICAL — Two systems using different data sources for the same metric

---

## EXECUTIVE SUMMARY

The Review Ranking page and AI Analyst page are calculating average ratings using **fundamentally different data sources**:

| System | Data Source | Method | Reviews | Average |
|--------|-------------|--------|---------|---------|
| **Review Ranking** | normalized_reviews | Latest 10 by timestamp | 10 | **4.9** |
| **AI Analyst** | product_daily_metrics | All in 30-day window | 13 | **4.69** |
| **Business Requirement** | — | Latest 10 reviews | — | **Should use 4.9** |

---

## DETAILED FINDINGS

### SOURCE A: Review Ranking Page (Latest 10 Reviews)

**Implementation:**
- File: `backend/src/database/queries/productRankingQueries.ts` (negative ranking, line 43-100)
- Query: Hand-written SQL with window functions
- Table: `normalized_reviews`
- Selection: `ROW_NUMBER() OVER (... ORDER BY COALESCE(review_timestamp, review_date::timestamp) DESC)`
- Filter: `review_rank <= 10`
- Calculation: `ROUND(AVG(rating)::numeric, 2)`

**Data for FKPID000457:**

```
Review # | ID (first 8 chars) | Date | Rating
1        | 773ef037...       | 2026-08-11 | 5
2        | eb87b496...       | 2026-08-09 | 5
3        | 12f8084f...       | 2026-08-06 | 5
4        | 03ce27b5...       | 2026-08-02 | 5
5        | a5fb2d67...       | 2026-07-30 | 5
6        | b9abd1ef...       | 2026-07-30 | 5
7        | a185161...        | 2026-07-27 | 5
8        | d1c9a75...        | 2026-07-27 | 5
9        | 0758db7c...       | 2026-07-24 | 4
10       | db975c56...       | 2026-07-22 | 5
```

**Calculation:**
```
Sum: 5+5+5+5+5+5+5+5+4+5 = 49
Count: 10
Average: 49 / 10 = 4.9
Rounded: 4.9
```

---

### SOURCE B: AI Analyst Page (Time-Window Aggregate)

**Implementation:**
- File: `backend/src/modules/ai/evidencePackage.ts` (line 58-136)
- Calls: `computeProductAnalytics()` → `computeCoreMetrics()`
- Table: `product_daily_metrics` (NOT normalized_reviews)
- Selection: ALL rows within date window
- Filter: `review_date >= startDate AND review_date <= endDate` (30-day window)
- Calculation: `Math.round((sum_of_rating_sums / sum_of_review_counts) * 100) / 100`

**Data for FKPID000457 (30-day window: 2026-07-20 to 2026-08-19):**

```
Review # | ID (first 8 chars) | Date | Rating
1        | 773ef037...       | 2026-08-11 | 5
2        | eb87b496...       | 2026-08-09 | 5
3        | 12f8084f...       | 2026-08-06 | 5
4        | 03ce27b5...       | 2026-08-02 | 5
5        | a5fb2d67...       | 2026-07-30 | 5
6        | b9abd1ef...       | 2026-07-30 | 5
7        | a185161...        | 2026-07-27 | 5
8        | d1c9a75...        | 2026-07-27 | 5
9        | 0758db7c...       | 2026-07-24 | 4
10       | db975c56...       | 2026-07-22 | 5
11       | a5084e46... [OLDER] | 2026-07-21 | 4
12       | 96832fc7... [OLDER] | 2026-07-21 | 4
13       | 450f3d94... [OLDER] | 2026-07-20 | 4
```

**Calculation:**
```
Sum: 5+5+5+5+5+5+5+5+4+5+4+4+4 = 61
Count: 13
Average: 61 / 13 = 4.6923076923076925
Rounded: 4.69
```

---

## ROOT CAUSE ANALYSIS

### Why the Difference?

The 3 additional reviews (11-13) in the window have ratings of 4, pulling the average down:

```
Latest 10 average:  49/10 = 4.90
Additional reviews: (4+4+4) = 12 sum from 3 reviews
All 13 average:     61/13 = 4.69

Difference: 4.90 - 4.69 = 0.21
```

### Architecture Problem

**The Two Systems Use Different Tables:**

1. **Review Ranking** — Direct SQL Query:
   ```sql
   WITH latest_per_product AS (
     SELECT ... rating ...
     FROM normalized_reviews nr
     ORDER BY COALESCE(review_timestamp, review_date::timestamp) DESC
   )
   SELECT ... ROUND(AVG(rating)::numeric, 2) as average_rating
   FROM latest_ten (WHERE review_rank <= 10)
   ```
   ✓ Selects LATEST 10 reviews, ignores date

2. **AI Analyst** — Aggregated Metrics Query:
   ```typescript
   computeProductAnalytics()
     → computeCoreMetrics()
       → queryAggregatedMetrics() // Queries product_daily_metrics table
   ```
   ✗ Selects ALL reviews in date window, NOT latest 10

**Code Evidence:**

File: `backend/src/modules/analytics/coreMetrics.ts` (lines 18-19):
```
"Every field here is computed from product_daily_metrics (never a raw 
normalized_reviews scan) except uniqueAuthorStrings..."
```

File: `backend/src/modules/analytics/metricsQuery.ts` (lines 30-34):
```
"The single query underneath every rollup in Phase 3 (core/product/brand/
platform analytics) — always reads product_daily_metrics, never scans
normalized_reviews..."
```

---

## BUSINESS REQUIREMENT VIOLATION

**Stated Requirement:**
> "Average rating should be based on the latest 10 reviews"

**Current Implementation Status:**
- ✓ Review Ranking: CORRECT (uses latest 10)
- ✗ AI Analyst: INCORRECT (uses time-window aggregates)

**Impact:**
- User sees different values in Review Ranking page (4.9) vs AI Analyst page (4.69)
- Both pages claim to show average rating, but calculate it differently
- This violates the principle of consistent data representation

---

## COMPARISON TABLE

| Aspect | Review Ranking | AI Analyst | Expected |
|--------|---|---|---|
| **Data Source** | normalized_reviews | product_daily_metrics | normalized_reviews |
| **Selection Method** | Latest 10 by timestamp | All in date window | Latest 10 |
| **Reviews Included** | 10 | 13 | 10 |
| **Average Calculated** | 4.9 | 4.69 | 4.9 |
| **Requirement Compliance** | ✓ YES | ✗ NO | ✓ YES |

---

## INVESTIGATION ARTIFACTS

**Script Used:** `backend/scripts/investigateRatingDiscrepancy.ts`

**Output:**
```
Review Ranking (Latest 10): 4.9
AI Analyst (30-day window): 4.69
All Reviews in Window: 4.69

Difference (Ranking - Analyst): 0.21
```

**Verification Cross-Check:**
- Queried normalized_reviews directly for 30-day window
- Result: 13 reviews, sum 61, average 4.69 ✓
- Matches product_daily_metrics aggregate exactly

---

## FILES INVOLVED

### Review Ranking (CORRECT for latest-10 requirement):
- `backend/src/database/queries/productRankingQueries.ts`
  - `getProductsRankedByNegativeReviews()` — line 43-100
  - `getProductsRankedByPositiveReviews()` — line 174-230
- `frontend/src/pages/ProductRankingList.tsx` — displays averageRating from API
- `frontend/src/api/endpoints/reviews.ts` — ProductRanking type includes averageRating

### AI Analyst (INCORRECT - uses time-window, not latest-10):
- `backend/src/modules/ai/evidencePackage.ts` — line 58-136 `buildProductEvidencePackage()`
  - Calls `computeProductAnalytics()` which does NOT use latest 10
- `backend/src/modules/ai/productAnalyst.ts` — uses evidencePackage
- `backend/src/modules/analytics/productAnalytics.ts` — calls `computeCoreMetrics()`
- `backend/src/modules/analytics/coreMetrics.ts` — line 60 `averageRating: ... / reviewCount`
- `backend/src/modules/analytics/metricsQuery.ts` — line 73-89 queries product_daily_metrics

---

## CONCLUSION

### Facts Established:

1. **Both systems calculate correctly** for their respective data sources
   - Review Ranking: 10 latest reviews → 4.9 ✓
   - AI Analyst: 13 window reviews → 4.69 ✓

2. **They use different data sources**
   - Review Ranking: normalized_reviews (per-review level)
   - AI Analyst: product_daily_metrics (aggregated daily)

3. **Business requirement explicitly states "latest 10 reviews"**
   - Review Ranking: Complies ✓
   - AI Analyst: Does NOT comply ✗

4. **The discrepancy is REAL, not rounding or precision error**
   - The difference is 0.21 (significant)
   - Root cause is 3 additional lower-rated reviews included by AI Analyst

### Recommendation:

**DO NOT PROCEED TO STEP 7 UNTIL THIS IS RESOLVED**

The AI Analyst module needs modification to use latest-10 reviews instead of time-window aggregates for its average rating calculation, to align with the business requirement and the Review Ranking implementation.

This requires architectural decision from the user about whether:
1. AI Analyst should also use latest-10 reviews (consistent with Review Ranking)
2. Review Ranking should also use time-window approach (consistent with AI Analyst)
3. Two different metrics should be displayed with different labels

---

## APPENDIX: Raw Query Results

**Review Ranking Latest 10 for FKPID000457:**
```
canonical_review_id | date | rating
773ef037807993e20d2981600dd3c900 | 2026-08-11 | 5
eb87b49654c94d5a0e48f80ee8250938 | 2026-08-09 | 5
12f8084ff1eb787e26323f532199ee31 | 2026-08-06 | 5
03ce27b514426acd34c259bd15006707 | 2026-08-02 | 5
a5fb2d678fbbb76930abcfc71c28f0a7 | 2026-07-30 | 5
b9abd1efa46a66098bcfe2fc7609c8bb | 2026-07-30 | 5
a185161534dc7a82cb144c160af31a03 | 2026-07-27 | 5
d1c9a754e2d0fd4ee8a166c5e3e47b79 | 2026-07-27 | 5
0758db7c642a90324011c363c75359ac | 2026-07-24 | 4
db975c56fd6658ffad5a1e21a84b1597 | 2026-07-22 | 5

Average: 4.9
```

**AI Analyst All Reviews in Window for FKPID000457:**
```
canonical_review_id | date | rating
[Reviews 1-10 same as above]
a5084e46e1aca8c96e66387795f0fecc | 2026-07-21 | 4
96832fc799fb02eeb77d71a23df897e7 | 2026-07-21 | 4
450f3d94f487f26315ff02794603b950 | 2026-07-20 | 4

Average: 4.69
```
