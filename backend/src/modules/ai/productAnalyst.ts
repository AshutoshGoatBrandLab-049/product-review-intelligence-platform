import type { Platform } from "../../types/unifiedReview.js";
import type { DateWindow, NamedWindow } from "../analytics/dateWindows.js";
import { resolveNamedWindow } from "../analytics/dateWindows.js";
import { buildProductEvidencePackage } from "./evidencePackage.js";
import { narrateProductEvidence } from "./narrator.js";
import { getCachedQuestion, cacheQuestion } from "./questionCache.js";
import { appSequelize } from "../../database/appStore/client.js";
import { config } from "../../config/index.js";
import { QueryTypes } from "sequelize";
import type { AiProvider } from "./providers/aiProvider.js";
import type { ProductAnalystResponse } from "../../api/controllers/analyst.js";

/**
 * Phase 10 Step 2 — AI Product Analyst orchestration with question caching.
 * Receives a user question about a specific product and determines what
 * verified data is needed, retrieves it, and passes it to the narrator.
 * Questions are cached with a 30-day TTL to avoid duplicate AI calls.
 */

export interface ProductAnalystRequest {
  platform: Platform;
  sourceProductId: string;
  userQuestion: string;
  window?: NamedWindow;
}

/**
 * Detect what time window the user is asking about from their natural language question.
 * Returns the detected window or defaults to "30d".
 */
function detectWindowFromQuestion(question: string): NamedWindow {
  const lowerQ = question.toLowerCase();

  if (lowerQ.includes("last 7") || lowerQ.includes("past 7") || lowerQ.includes("7 day")) return "7d";
  if (lowerQ.includes("last 30") || lowerQ.includes("past 30") || lowerQ.includes("30 day")) return "30d";
  if (lowerQ.includes("last 60") || lowerQ.includes("past 60") || lowerQ.includes("60 day")) return "60d";
  if (lowerQ.includes("last 90") || lowerQ.includes("past 90") || lowerQ.includes("90 day")) return "90d";
  if (lowerQ.includes("last 6") || lowerQ.includes("past 6") || lowerQ.includes("6 month")) return "6m";
  if (lowerQ.includes("last year") || lowerQ.includes("past year") || lowerQ.includes("yearly")) return "12m";

  return "30d";
}

/**
 * Check if this product exists by attempting to retrieve its basic analytics.
 */
async function verifyProductExists(platform: Platform, sourceProductId: string, window: DateWindow): Promise<boolean> {
  const schema = config.appStore.schema;

  const result = (await appSequelize.query(
    `SELECT COUNT(*) as count FROM "${schema}".normalized_reviews
     WHERE platform = :platform AND source_product_id = :sourceProductId
     AND review_date >= :start AND review_date <= :end`,
    {
      type: QueryTypes.SELECT,
      replacements: { platform, sourceProductId, start: window.start, end: window.end },
    },
  )) as any[];

  return result.length > 0 && (result[0] as any)?.count > 0;
}

/**
 * Analyze a product question using verified data and AI grounding.
 * Phase 10 Step 2: Implements 30-day TTL question caching to avoid duplicate API calls.
 * This is the main orchestrator for the Product Analyst feature.
 */
export async function analyzeProductQuestion(
  request: ProductAnalystRequest,
  aiProvider: AiProvider,
): Promise<ProductAnalystResponse> {
  const window = resolveNamedWindow(request.window ?? detectWindowFromQuestion(request.userQuestion));

  // Phase 10 Step 2: Check question cache first (30-day TTL)
  const cached = await getCachedQuestion(request.platform, request.sourceProductId, window, request.userQuestion);
  if (cached) {
    return cached;
  }

  // Verify product exists
  const exists = await verifyProductExists(request.platform, request.sourceProductId, window);
  if (!exists) {
    throw new Error(`Product not found: ${request.platform}/${request.sourceProductId}`);
  }

  // Build the evidence package (this contains all verified data about the product)
  const evidencePackage = await buildProductEvidencePackage(request.platform, request.sourceProductId, window);

  // Use the narrator to generate a grounded analysis
  const result = await narrateProductEvidence(evidencePackage, aiProvider);

  const response: ProductAnalystResponse = {
    platform: request.platform,
    sourceProductId: request.sourceProductId,
    window,
    userQuestion: request.userQuestion,
    answer: result.summary, // Primary answer is the summary
    analysis: result, // Full analysis with root causes, recommendations, citations
    cacheHit: false,
  };

  // Phase 10 Step 2: Cache the validated result (never raw model output)
  await cacheQuestion(request.platform, request.sourceProductId, window, request.userQuestion, response);

  return response;
}
