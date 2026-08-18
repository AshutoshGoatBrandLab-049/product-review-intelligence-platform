# Phase 10 Phase C — Implementation Plan

**Status**: IN PROGRESS  
**Target**: Real semantic planning + execution + grounded answers

## Scope Overview

PHASE C integrates PHASE A (registry, validator, executor) + PHASE B (semantic planner) into the actual product intelligence engine, replacing stubs with real operations.

**Key Deliverables**:
1. Real operation handlers (replace stubs)
2. productAnalyst.ts integration (planner routing)
3. Natural language support (English, Hinglish, all variants)
4. Evidence integrity (strict validation)
5. Honest error/unknown handling
6. Held-out real-provider validation (200+ test cases)
7. Complete documentation

## Implementation Steps

### STEP 1: Real RETRIEVE_REVIEWS Handler
- Use existing `reviewRetrieval.ts`
- Support all filters (sentiment, aspect, timeframe, limit, rating)
- Preserve correct ordering (latest/oldest)
- Return actual DB fields (never fabricate)

### STEP 2: Real ANALYZE_REVIEW_SET Handler
- Use existing `semanticAnalysis.ts`
- Accept review set from RETRIEVE_REVIEWS
- Perform LLM analysis on actual text
- Return typed `AnalysisResult` with evidence IDs
- Enforce evidence integrity

### STEP 3: Real ANALYZE_ASPECT Handler
- Retrieve reviews for specific aspect
- Analyze sentiment/patterns
- Use review text as primary source
- No THEME_VOCABULARY constraints

### STEP 4: Real GET_PRODUCT_ANALYTICS Handler
- Use existing analytics modules
- Return: reviewCount, averageRating, sentimentDistribution, topThemes, trendDirection
- Deterministic calculations only

### STEP 5: Real COMPARE_PERIODS Handler
- Use existing `periodComparison.ts`
- Calculate current + previous window analytics
- Return deltas (reviewCountDelta, ratingDelta, trendChange)
- Verify both windows are comparable

### STEP 6: Real ANALYZE_TREND Handler
- Detect trend direction (improving/declining/stable)
- Use existing trend logic
- Return confidence level

### STEP 7: Real COMPARE_MARKETPLACES Handler
- Check if product_family_mapping exists
- If yes: use `compareProductByFamily()`
- If no: return honest "unavailable" response
- Never fabricate cross-marketplace data

### STEP 8: Real GET_SUPPORTING_EVIDENCE Handler
- Accept prior analysis result
- Extract evidence review IDs
- Validate against DB
- Return matching reviews

### STEP 9: Real GENERAL_ASSESSMENT Handler
- Broad evidence-grounded assessment
- Multiple concerns + evidence
- Rating situation
- Notable patterns
- Honest about insufficient data

### STEP 10: productAnalyst.ts Integration
- Try semantic planner first
- If planner succeeds: validate + execute plan
- Pass execution results to narrator
- Fallback to queryResolution.ts if planner fails
- Preserve conversation context

### STEP 11: Narrator Updates
- Receive structured operation results
- DO NOT re-query, re-analyze, or re-calculate
- Answer actual question directly
- Cite only validated evidence
- Use honest language for unknowns

### STEP 12: Natural Language Support
- Hinglish parsing (pichle, dikkat, scene, etc.)
- Informal language (sucks, hate, awesome, etc.)
- Fragments (latest, bad, size, etc.)
- Typos/grammar errors
- Mixed language

### STEP 13: Context Resolution
- Load conversation context
- Resolve pronouns (it, that, those, them)
- Apply prior aspect/timeframe
- Clarify ambiguous follow-ups

### STEP 14: Evidence Validation
- Strict invariant: reportedCount === unique(evidenceReviewIds).length
- Every ID must exist in normalized_reviews
- Every ID must match: platform, product, timeframe
- No fabricated or altered evidence

### STEP 15: Unknown/Insufficient Data
- Distinguish KNOWN from CALCULATED from INFERRED
- Report UNKNOWN honestly
- Flag INSUFFICIENT DATA
- Do NOT convert to false confidence

### STEP 16: Held-Out Real-Provider Validation
- 20 natural-language paraphrases
- 20 Hindi/Hinglish questions
- 20 informal/typo/fragment questions
- 20 free-form aspect questions
- 20 retrieval questions
- 20 analysis questions
- 20 recommendation questions
- 20 multi-operation questions
- 20 follow-up questions
- 20 adversarial pairs
- **Total: 200+ test cases**
- Real OpenAI provider
- Cross-validate against DB
- Verify every claim

### STEP 17: Test Suite
- Add real operation handler tests
- Add integration tests (planner → executor → narrator)
- Add held-out real-provider tests
- Preserve existing tests
- Report before/after counts

### STEP 18: Validation & Safety
- Backend typecheck
- Backend test suite
- Frontend typecheck
- Frontend test suite
- Production builds
- Safety checks
- Database integrity (read-only)
- No secrets in code/reports
- No API keys exposed

### STEP 19: Documentation
- Phase C completion report
- Operation handler coverage
- Natural language coverage
- Evidence integrity proof
- Held-out test results
- Before/after test counts
- Known limitations
- Evidence classification (PROVEN vs OBSERVED vs INFERRED)

## File Changes Summary

### New Files
- Real handler implementations (embedded in operationExecutor or separate)
- Held-out test suite (200+ cases)

### Modified Files
- operationExecutor.ts (replace stubs with real handlers)
- productAnalyst.ts (integrate semantic planner)
- narrator.ts (receive structured results)
- aiProvider.ts (if needed for additional context)

### Unchanged Files
- PHASE A infrastructure (operationRegistry, planValidator)
- PHASE B planner (semanticPlanner, planningPrompt)
- Existing analytics modules (reused, not duplicated)
- Database schema
- Frontend core (minimal changes only)

## Test Metrics

### Before PHASE C
- Backend: 476 passed + 15 skipped
- Frontend: 305 passed
- Real-provider validation: 0

### Target After PHASE C
- Backend: 500+ passed + 15 skipped
- Frontend: 305+ passed (unchanged or improved)
- Real-provider validation: 200+ passed

## Success Criteria

1. ✅ Semantic plan → Real data ✅ Correct evidence
2. ✅ Natural language understood (English, Hinglish, variants)
3. ✅ Evidence integrity preserved
4. ✅ Unknown/insufficient data handled honestly
5. ✅ All 9 operation types functional
6. ✅ Follow-up context resolved
7. ✅ No fabricated data
8. ✅ 200+ held-out tests pass
9. ✅ All test suites green
10. ✅ Database read-only

## Timeline

**Now**: Core operation handlers  
**Next**: productAnalyst integration  
**Then**: Narrator updates  
**After**: Held-out validation  
**Final**: Documentation & sign-off

---

**PHASE C begins now.**
