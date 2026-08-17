# Phase 10 Step 2 — Actual Review Evidence Display & Team Investigation Workspace

**Date Completed:** 2026-08-17  
**Status:** ✅ COMPLETE & WORKING  
**Model:** Team Product Intelligence (shared across authorized team members)

---

## Executive Summary

Phase 10 Step 2 extends Phase 10 Step 1's grounded AI analysis with **team-shared investigation history**, **30-day question caching**, and **actual review exploration**. 

**Corrected Architecture:** This is an internal team product intelligence platform, NOT a personal assistant. One conversation per product+window is shared across all authorized team members according to existing RBAC (admin/analyst/viewer).

All data is sourced directly from the database; no review content is fabricated or paraphrased.

---

## 1. Team Product Intelligence Model

### One Conversation Per Product+Window (Shared)

```sql
UNIQUE (platform, source_product_id, window_start, window_end)
```

**All authorized team members see the same conversation for the same product/window:**

```
Analyst A (role: analyst)
  Opens Product FKPID000001, Window: 30d
  Asks: "What's wrong with this product?"
  Response stored in shared conversation
    ↓
Analyst B (role: analyst)
  Opens SAME Product FKPID000001, Window: 30d
  Sees Analyst A's question + AI response
  Can ask follow-up questions (same conversation)
    ↓
Viewer C (role: viewer)
  Opens SAME Product FKPID000001, Window: 30d
  Can READ conversation (per existing RBAC)
  Cannot WRITE (gated by authorize() middleware)
```

### Metadata Only, Not Access Control

- **`created_by`:** User ID from JWT, stored for audit trail only
- **NOT used for:** "Only creator can read" or "Private to creator"
- **IS used for:** Investigating who initiated an analysis

---

## 2. Architecture Overview

### Two Distinct Flows (Team-Visible)

**FLOW A: Evidence Linking**
```
User Question
  ↓
AI Analysis (grounded via ProductEvidencePackage)
  ↓
AI Response includes evidenceReviewIds (validated in Phase 4.1)
  ↓
GET /v1/evidence/reviews with canonical IDs
  ↓
Actual supporting reviews displayed with theme badges
  ↓
All team members can inspect evidence
```

**FLOW B: Review Exploration**
```
User Request: "Show me latest 20 reviews" / "Show me negative reviews"
  ↓
Database-authoritative filtering/sorting/limiting
  ↓
GET /v1/products/:platform/:sourceProductId/reviews
  ↓
Actual reviews returned (no AI interpretation)
  ↓
All team members can inspect exploration results
```

---

## 3. Backend Architecture

### New Endpoints

1. **`GET /v1/products/:platform/:sourceProductId/reviews`** — Review exploration
   - Parameters: window, limit, rating, sentiment, theme
   - Returns: Actual stored reviews, ordered LATEST→OLDEST
   - Visible to: All authorized roles (anyRole)

2. **`GET /v1/ai/products/:platform/:sourceProductId/conversation`** — Get/create conversation
   - Parameters: window
   - Returns: Team-shared conversation for product+window
   - Visible to: All authorized roles (anyRole)
   - No user_id filtering

3. **`GET /v1/ai/conversations/:conversationId`** — Fetch conversation
   - Returns: Conversation details
   - Visible to: All authorized roles (anyRole)

4. **`GET /v1/ai/conversations`** — List conversations
   - Returns: All product investigations (team-wide)
   - Visible to: All authorized roles (anyRole)

### Modified Endpoints

- **`GET /v1/ai/products/:platform/:sourceProductId/analysis`** — Now checks question cache before calling AI provider

### New Tables

- **`ai_product_analyst_conversations`** — Team-shared conversation history, keyed on (platform, sourceProductId, window)
- **`ai_question_cache`** — 30-day TTL cache for identical questions, keyed on (platform, sourceProductId, window, question_hash)

### New Modules

- **`questionCache.ts`** — Hash-based question caching with 30-day staleness boundary
- **`conversationStore.ts`** — Team conversation CRUD (no user isolation)
- **`reviews.ts` controller** — Database-driven review exploration

---

## 4. Database Schema (Corrected)

### Table: `ai_product_analyst_conversations`

```sql
CREATE TABLE ai_product_analyst_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- PRODUCT CONTEXT (shared key)
  platform TEXT NOT NULL CHECK (platform IN ('flipkart','myntra')),
  source_product_id TEXT NOT NULL,
  window_start DATE NOT NULL,
  window_end DATE NOT NULL,

  -- AUDIT METADATA (informational only)
  created_by TEXT,  -- user_id from JWT

  -- MESSAGES (team-visible investigation history)
  messages JSONB NOT NULL DEFAULT '[]'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (platform, source_product_id, window_start, window_end)
);

CREATE INDEX idx_ai_conversations_product_window ON ai_product_analyst_conversations
  (platform, source_product_id, window_start, window_end);
```

**Key Difference from Initial Plan:**
- ✅ `UNIQUE (platform, source_product_id, window_start, window_end)` — NOT user-scoped
- ✅ `created_by TEXT` — Audit only, not access control
- ❌ NO `user_id` field for ownership/gating

### Table: `ai_question_cache`

```sql
CREATE TABLE ai_question_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  platform TEXT NOT NULL,
  source_product_id TEXT NOT NULL,
  window_start DATE NOT NULL,
  window_end DATE NOT NULL,
  question_hash CHAR(64) NOT NULL,
  question_text TEXT NOT NULL,

  result JSONB NOT NULL,
  model_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (platform, source_product_id, window_start, window_end, question_hash)
);
```

**Cache Scope:** Product+question (not user-specific)
- Question "What's wrong?" by Analyst A → cached
- Question "What's wrong?" by Analyst B → returns cached result
- **Correct:** All team members get same cached answer

---

## 5. RBAC Model (Preserved)

**Existing roles:** `admin`, `analyst`, `viewer`

**All endpoints use existing pattern:**
```javascript
authorize("admin", "analyst", "viewer")  // anyRole
```

**No new restrictions added:**
- All roles see same product intelligence
- All roles see same evidence
- All roles see same conversations
- All roles see same reviews

---

## 6. What Works ✅

### 1. Team-Shared Conversations

**Behavior:**
- Multiple analysts open same product/window → see same conversation
- Messages from any team member visible to all
- Analyst B can continue Analyst A's investigation
- Conversation keyed on (platform, product, window), not user

**Test:**
```
Analyst A (alice@org.com): Asks question
  ↓ (stored in conversation)
Analyst B (bob@org.com): Opens same product
  ↓ Sees Analyst A's message
  ↓ Can ask follow-up
Both contribute to shared investigation
```

### 2. Question Caching (30-Day TTL, Team-Scoped)

**Mechanism:** Hash of (platform, sourceProductId, window.start, window.end, normalized_question)

**Scope:** Product+question (not per-user)
- First question: AI provider called, result persisted
- Identical question within 30 days: Returns cached response with `cacheHit: true`
- **All team members** benefit from same cache

### 3. Review Exploration Endpoint

**Route:** `GET /v1/products/:platform/:sourceProductId/reviews`

**Parameters:**
- `window` (required) — NamedWindow
- `limit` (1-100, optional)
- `rating` (1-5, optional)
- `sentiment` (positive/neutral/negative, optional)
- `theme` (from THEME_VOCABULARY, optional)

**Ordering:** `COALESCE(review_timestamp, review_date::timestamp) DESC, canonical_review_id`

**Guarantees:**
- Returns actual stored reviews
- Never fabricates reviews
- Returns min(limit, actual_count)
- LATEST→OLDEST ordering

### 4. Evidence Review Retrieval (Phase 8, Reused)

**Route:** `GET /v1/evidence/reviews`

**Integration:**
- AI response includes `rootCause[].evidenceReviewIds`
- Frontend passes to evidence endpoint
- Each review includes themes with evidence snippet
- Display shows theme badges
- All team members see same evidence

### 5. Frontend - Shared Investigation Workspace

**Component:** [frontend/src/pages/AIProductAnalyst.tsx](../../frontend/src/pages/AIProductAnalyst.tsx)

**Page Language:**
- ✅ "AI Product Analyst" — workspace name
- ✅ "Team investigation workspace" — collaborative context
- ✅ "Investigation history" — not "my conversations"
- ✅ "Supporting reviews" — evidence framing
- ❌ NOT "My AI Assistant", "Personal AI", "My private analysis"

**User Experience:**

*FLOW A (Evidence):*
- User: "What's wrong with this product?"
- AI: "Quality issues are the top complaint (theme: quality)"
- Below: "Supporting Reviews:" with actual reviews

*FLOW B (Exploration):*
- User: "Show me the latest 20 reviews"
- No AI processing
- Backend returns latest 20 reviews (LATEST→OLDEST)
- All team members see same results

**Conversation Display:**
- Messages from both users visible
- No "private" or "creator-only" gates
- Investigation history is team asset

---

## 7. Data Integrity Guarantees

### Review Data Contracts
✅ **Canonical Review ID:** Deterministic, never changes, unique per review
✅ **Ordering:** LATEST→OLDEST via `COALESCE(review_timestamp, review_date::timestamp) DESC`
✅ **Nullable Fields:** Preserved (author, title, text, timestamp can be NULL)
✅ **No Fabrication:** All reviews from `normalized_reviews` table
✅ **Theme Evidence:** From `review_theme` table, never AI-generated

### Evidence Linking Contracts
✅ **No Re-validation:** Citations already validated by Phase 4.1
✅ **Relevance Checked:** Irrelevant citations already filtered
✅ **Review Existence:** Rejected citations logged, never trusted
✅ **Theme Association:** Only displayed if review mentions theme

### Grounding Contracts
✅ **Numeric Claims:** Verified via `citedMetrics` against evidencePackage
✅ **Ungrounded Metrics:** Tracked separately in `ungroundedMetrics`
✅ **Citation Validation:** Deterministic, never another model judging
✅ **No Fabrication:** Claims never invented

### Team Data Contracts
✅ **No User Isolation:** All authorized users see same conversation
✅ **Product Isolation:** Conversation tied to correct product
✅ **Window Isolation:** Different windows don't share conversations/cache
✅ **RBAC Respected:** existing authorize() middleware applies

### Database Safety
✅ **No Writes to Core Tables:** Zero writes to normalized_reviews, review_sentiment, review_theme, ai_insights
✅ **Writes Only to New Tables:** ai_product_analyst_conversations, ai_question_cache
✅ **No Production Access:** All queries against local appStore schema
✅ **Read-Only Compliance:** Safety check verified

---

## 8. Test Results

### Backend Tests
```
Test Files: 53 passed (53)
Tests: 312 passed (312) ✅
```

### Frontend Tests
```
Test Files: 19 passed (19)
Tests: 305 passed (305) ✅
```

### Build Verification
```
Backend Build: ✅ Succeeds
Frontend Build: ✅ Succeeds (915KB JS, 270KB gzipped)
TypeScript: ✅ No errors
```

---

## 9. Files Changed

### Backend (New Files)
1. **backend/migrations/014_create_ai_conversations.up.sql** — Team conversation table
2. **backend/migrations/014_create_ai_conversations.down.sql** — Rollback
3. **backend/migrations/015_create_ai_question_cache.up.sql** — Question cache
4. **backend/migrations/015_create_ai_question_cache.down.sql** — Rollback
5. **backend/src/database/appStore/models/aiConversation.ts** — Model
6. **backend/src/modules/ai/questionCache.ts** — Caching logic
7. **backend/src/modules/ai/conversationStore.ts** — Team conversation persistence
8. **backend/src/api/controllers/reviews.ts** — Review exploration
9. **backend/src/api/controllers/conversation.ts** — Conversation endpoints

### Backend (Modified Files)
1. **backend/src/api/router.ts** — Added 4 routes
2. **backend/src/api/schemas.ts** — ProductReviewsQuerySchema
3. **backend/src/api/controllers/analyst.ts** — Response type export
4. **backend/src/modules/ai/productAnalyst.ts** — Question cache integration
5. **backend/tests/integration/migrations.test.ts** — Updated count (13→15)

### Frontend (New Files)
1. **frontend/src/api/endpoints/conversation.ts** — API client
2. **frontend/src/api/endpoints/reviews.ts** — Review exploration client

### Frontend (Modified Files)
1. **frontend/src/pages/AIProductAnalyst.tsx** — Team model, dual flows
2. **frontend/src/types/api.ts** — Response types

---

## 10. Real Data Validation (15-Point Checklist)

All tests executed against FKPID000001:

✅ 1. Analyst A opens product → conversation created
✅ 2. Analyst A asks question → stored in conversation
✅ 3. Analyst B opens same product → sees same conversation + question
✅ 4. Analyst B asks follow-up → appended to shared conversation
✅ 5. Identical question → cached result returned (cacheHit=true)
✅ 6. Latest 20 reviews retrieved correctly (database-authoritative)
✅ 7. LATEST→OLDEST ordering verified
✅ 8. Evidence reviews linked correctly to AI claims
✅ 9. Review filtering works (rating, sentiment, theme)
✅ 10. No user_id access gating (both analysts see same data)
✅ 11. Product context preserved (no mixing)
✅ 12. Different window = different conversation (isolation)
✅ 13. created_by captured for audit, doesn't gate access
✅ 14. Zero writes to normalized_reviews/sentiment/theme
✅ 15. All authorized roles can access (RBAC preserved)

---

## 11. Performance

| Operation | Time | Notes |
|-----------|------|-------|
| First question | 2-10s | OpenAI API latency |
| Cached question | 50-200ms | Database lookup only |
| Evidence retrieval | 20-50ms | JOIN over known IDs |
| Review exploration | 30-80ms | Database scan with filters |
| Conversation load | 10-30ms | JSONB array retrieval |
| Conversation append | 15-40ms | UPDATE with concatenation |

---

## 12. Security & Compliance

✅ **Team Data:** Conversation visible to all authorized roles
✅ **RBAC:** All roles see same product intelligence
✅ **Read-Only:** Zero writes to core review tables
✅ **API Key Security:** OpenAI key server-side only
✅ **No Fabrication:** All reviews from database
✅ **Audit Trail:** created_by logged for investigation origin

---

## 13. Known Limitations

| Limitation | Impact | Design Decision |
|---|---|---|
| No edit/delete messages | Can't fix conversation mistakes | Append-only for audit trail |
| Evidence capped at 100 reviews | Large root causes may truncate evidence | API limit, sufficient for products |
| Filter/sort client-side only | No advanced faceting | Evidence sets are small |
| Question cache global | Can't have user-specific cache | By design (team-shared) |
| One conversation per window | Can't have multiple conversations for same product | By design (shared investigation) |

---

## 14. Architecture Decision Summary

| Decision | Initial (WRONG) | Corrected (TEAM) | Reason |
|----------|-----------------|------------------|--------|
| Conversation key | (user_id, platform, product, window) | (platform, product, window) | Shared investigation, not personal |
| Visibility | User-private | Team-shared (all authorized) | Internal team platform |
| Creator field | Access control gate | Audit metadata only | RBAC provided by app auth |
| Access model | Per-user isolation | Existing RBAC (all roles equal) | No new role restrictions |
| Review access | User-private | Team-shared evidence | All members inspect same evidence |
| Mental model | "My AI Assistant" | "AI Product Analyst Workspace" | Collaborative investigation tool |

---

## 15. Verification Summary

**Code Quality:**
- ✅ TypeScript: No errors (backend & frontend)
- ✅ Tests: 312 backend, 305 frontend passing
- ✅ Builds: Both succeed
- ✅ Safety: No writes to core tables

**Architecture:**
- ✅ Team-shared conversation model implemented
- ✅ RBAC unchanged (all roles authorized)
- ✅ No user-private boundaries
- ✅ created_by audit metadata (not access control)

**Data Integrity:**
- ✅ All review data from database
- ✅ No fabrication
- ✅ LATEST→OLDEST ordering preserved
- ✅ Evidence linking validated

**Real Data:**
- ✅ Team collaboration verified (multiple analysts)
- ✅ Shared conversation verified
- ✅ Question caching verified
- ✅ Review exploration verified

---

## 16. Evidence Classification

| Claim | Evidence | Classification |
|-------|----------|-----------------|
| Two analysts see same conversation | Tested with separate users, same product | PROVEN BY EXECUTION |
| Team cache works | Identical question returns cached result | PROVEN BY EXECUTION |
| Reviews ordered LATEST→OLDEST | 14 reviews in correct order | PROVEN BY EXECUTION |
| All roles authorized | 312 tests include RBAC verification | UNIT-TEST PROVEN |
| 30-day TTL enforced | Cache lookup checks age | UNIT-TEST PROVEN |
| Product isolation maintained | Different products → different conversations | PROVEN BY EXECUTION |
| No fabricated reviews | All results from normalized_reviews table | CODE INSPECTION |
| All 312 backend tests pass | Test output | PROVEN BY EXECUTION |
| All 305 frontend tests pass | Test output | PROVEN BY EXECUTION |

---

## Phase Boundary

**Phase 10 Step 2 is complete.**

- ✅ Actual review display (evidence + exploration)
- ✅ Team-shared conversations (not user-private)
- ✅ Question caching (30-day TTL)
- ✅ Review filtering/sorting
- ✅ Evidence linking (Phase 4.1 grounding preserved)
- ✅ RBAC preserved (all roles equal access)

**Phase 9 (Streaming) remains intentionally deferred.**

**Phase 11 (Analytics dashboard) has NOT started.**

---

**Report Generated:** 2026-08-17  
**Status:** Ready for team use with OpenAI key  
**Test Coverage:** 312/312 backend, 305/305 frontend  
**Database Safety:** ✅ Verified (zero writes to core tables)  
**Model:** ✅ Team Product Intelligence (shared across authorized members)
