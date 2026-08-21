import { Router } from "express";
import { authenticate, authorize } from "./middleware/authenticate.js";
import { validateParams, validateQuery } from "./middleware/validate.js";
import { asyncHandler } from "./asyncHandler.js";
import {
  ProductParamsSchema,
  BrandParamsSchema,
  FamilyParamsSchema,
  WindowQuerySchema,
  RankingsQuerySchema,
  ProblemsQuerySchema,
  EarlyWarningsQuerySchema,
  EvidenceReviewsQuerySchema,
  AnalystQuerySchema,
  ProductReviewsQuerySchema,
} from "./schemas.js";
import { getProductDetail, getProductSignals, getProductInsights } from "./controllers/products.js";
import { getBrandComparison } from "./controllers/brands.js";
import { getProductFamilyComparison } from "./controllers/marketplace.js";
import { getEarlyWarnings } from "./controllers/earlyWarnings.js";
import { getExecutiveDashboard } from "./controllers/dashboard.js";
import { getProductRankings } from "./controllers/rankings.js";
import { getProblems } from "./controllers/problems.js";
import { getEvidenceReviews } from "./controllers/evidence.js";
import { getProductReviews, getReviewsOverview } from "./controllers/reviews.js";
import { getIngestionStatus, getAiUsage } from "./controllers/system.js";
import { analyzeProduct } from "./controllers/analyst.js";
import { getOrCreateProductConversation, getConversationDetails, listConversations } from "./controllers/conversation.js";
import ingestionRouter from "./routes/ingestion.js";

/**
 * Phase 6 Step 2 — the approved 11-endpoint set (§5), and nothing else.
 * Every route: authenticate -> (authorize if role-restricted) -> validate
 * -> controller. All 11 are GET, matching the "Phase 6 v1 is READ-ONLY"
 * decision — no PATCH/POST routes exist anywhere in this router.
 */
export const apiRouter = Router();

const anyRole = authorize("admin", "analyst", "viewer");
const adminOnly = authorize("admin");

apiRouter.get(
  "/v1/products/:platform/:sourceProductId",
  authenticate,
  anyRole,
  validateParams(ProductParamsSchema),
  validateQuery(WindowQuerySchema),
  asyncHandler(getProductDetail),
);

apiRouter.get(
  "/v1/products/:platform/:sourceProductId/signals",
  authenticate,
  anyRole,
  validateParams(ProductParamsSchema),
  validateQuery(WindowQuerySchema),
  asyncHandler(getProductSignals),
);

apiRouter.get(
  "/v1/products/:platform/:sourceProductId/insights",
  authenticate,
  anyRole,
  validateParams(ProductParamsSchema),
  validateQuery(WindowQuerySchema),
  asyncHandler(getProductInsights),
);

apiRouter.get(
  "/v1/brands/:brand/compare",
  authenticate,
  anyRole,
  validateParams(BrandParamsSchema),
  validateQuery(WindowQuerySchema),
  asyncHandler(getBrandComparison),
);

apiRouter.get(
  "/v1/products/family/:familyId/compare",
  authenticate,
  anyRole,
  validateParams(FamilyParamsSchema),
  validateQuery(WindowQuerySchema),
  asyncHandler(getProductFamilyComparison),
);

apiRouter.get("/v1/early-warnings", authenticate, anyRole, validateQuery(EarlyWarningsQuerySchema), asyncHandler(getEarlyWarnings));

apiRouter.get("/v1/dashboard/executive", authenticate, anyRole, validateQuery(WindowQuerySchema), asyncHandler(getExecutiveDashboard));

apiRouter.get("/v1/products/rankings", authenticate, anyRole, validateQuery(RankingsQuerySchema), asyncHandler(getProductRankings));

apiRouter.get("/v1/problems", authenticate, anyRole, validateQuery(ProblemsQuerySchema), asyncHandler(getProblems));

apiRouter.get(
  "/v1/evidence/reviews",
  authenticate,
  anyRole,
  validateQuery(EvidenceReviewsQuerySchema),
  asyncHandler(getEvidenceReviews),
);

apiRouter.get(
  "/v1/products/:platform/:sourceProductId/reviews",
  authenticate,
  anyRole,
  validateParams(ProductParamsSchema),
  validateQuery(ProductReviewsQuerySchema),
  asyncHandler(getProductReviews),
);

apiRouter.get(
  "/v1/reviews/overview",
  authenticate,
  anyRole,
  asyncHandler(getReviewsOverview),
);

apiRouter.get(
  "/v1/ai/products/:platform/:sourceProductId/analysis",
  authenticate,
  anyRole,
  validateParams(ProductParamsSchema),
  validateQuery(AnalystQuerySchema),
  asyncHandler(analyzeProduct),
);

apiRouter.get(
  "/v1/ai/products/:platform/:sourceProductId/conversation",
  authenticate,
  anyRole,
  validateParams(ProductParamsSchema),
  asyncHandler(getOrCreateProductConversation),
);

apiRouter.get(
  "/v1/ai/conversations/:conversationId",
  authenticate,
  anyRole,
  asyncHandler(getConversationDetails),
);

apiRouter.get(
  "/v1/ai/conversations",
  authenticate,
  anyRole,
  asyncHandler(listConversations),
);

// System endpoints — admin-only, matching §18's original "Live, admin-only" designation.
apiRouter.get("/v1/system/ingestion-status", authenticate, adminOnly, asyncHandler(getIngestionStatus));
apiRouter.get("/v1/system/ai-usage", authenticate, adminOnly, asyncHandler(getAiUsage));

/**
 * Internal ingestion endpoints — admin-only.
 *
 * These were previously mounted with NO auth at all, unlike every other route in
 * this file. POST /internal/ingestion/trigger runs a full ingestion cycle,
 * including the replacement path that deletes and rebuilds canonical data, so an
 * unauthenticated caller who could reach the port could destroy and rewrite the
 * dataset. Ingestion is at least as privileged as the read-only system endpoints
 * above, so it gets the same authenticate + adminOnly treatment.
 *
 * /internal/ingestion/health stays open: it reports readiness only, exposes no
 * data, and is the kind of endpoint a load balancer probes without credentials.
 */
apiRouter.use("/internal", (req, res, next) => {
  if (req.path === "/ingestion/health") return next();
  return authenticate(req, res, (err?: unknown) =>
    err ? next(err) : adminOnly(req, res, next),
  );
}, ingestionRouter);
