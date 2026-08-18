import { GoogleGenAI, Type, ApiError } from "@google/genai";
import { AiProviderError, type AiFailureCategory, type AiProvider } from "./aiProvider.js";
import type { AiAnalysisInput, ReviewWithText } from "../types.js";
import type { ProductEvidencePackage } from "../evidencePackage.js";
import { CITABLE_METRIC_FIELDS } from "../narrator.js";
import { THEME_VOCABULARY } from "../../../database/appStore/models/reviewTheme.js";
import type { AnalyticalIntent } from "../intentDetection.js";
import { describeIntent, recommendationInstructionLine } from "../intentDetection.js";
import { QUERY_ACTIONS } from "../queryResolution.js";
import type { QueryResolutionInput } from "../queryUnderstanding.js";
import { QUERY_RESOLUTION_SYSTEM_PROMPT } from "./queryResolutionPrompt.js";

interface GeminiErrorBody {
  error?: {
    status?: string;
    details?: Array<{ "@type"?: string; reason?: string; retryDelay?: string }>;
  };
}

/**
 * Phase 4.1 remediation item 2/6 — classifies a raw Gemini SDK error into a
 * retryability decision, a failure category, and (when the API supplied
 * one) a suggested retry delay. Reads the ACTUAL @google/genai ApiError
 * shape (status + a JSON-stringified body) — verified against real payloads
 * captured in Phase 4.1, never assumed:
 *   - 429 (RESOURCE_EXHAUSTED) with RetryInfo.retryDelay — Steps 4/11.
 *   - 400 (INVALID_ARGUMENT) with details[].reason === "API_KEY_INVALID" for
 *     a bad API key — discovered during Step 11 reconciliation (remediation
 *     item 6); the status code alone (400) would otherwise misclassify a real
 *     auth failure as a generic, non-specific provider_error. This is why the
 *     reason code is checked, not just the HTTP status.
 *   - 404 (NOT_FOUND) for an invalid model name — same investigation.
 * Falls back to a safe, retryable default for any error shape that isn't
 * ApiError (e.g. network failures) — timeout-shaped messages are recognized
 * heuristically since no real timeout has been observed to verify against.
 */
export function classifyGeminiError(err: unknown): { message: string; retryable: boolean; category: AiFailureCategory; retryAfterMs?: number } {
  if (err instanceof ApiError) {
    const status = err.status;
    let body: GeminiErrorBody | undefined;
    try {
      body = JSON.parse(err.message) as GeminiErrorBody;
    } catch {
      // err.message wasn't JSON — proceed with status-only classification.
    }

    const reasonCodes = (body?.error?.details ?? []).map((d) => d.reason).filter((r): r is string => !!r);
    const isAuthFailure = reasonCodes.includes("API_KEY_INVALID") || status === 401 || status === 403;

    let category: AiFailureCategory;
    let retryable: boolean;
    if (status === 429) {
      category = "provider_rate_limit";
      retryable = true;
    } else if (isAuthFailure) {
      category = "provider_auth";
      retryable = false;
    } else if (status >= 500) {
      category = "provider_unavailable";
      retryable = true;
    } else {
      category = "provider_error";
      retryable = false; // other 4xx (e.g. 404 unknown model) — retrying the same request won't help
    }

    let retryAfterMs: number | undefined;
    const retryInfo = body?.error?.details?.find((d) => d["@type"]?.endsWith("RetryInfo"));
    if (retryInfo?.retryDelay) {
      const seconds = Number.parseFloat(retryInfo.retryDelay.replace(/s$/, ""));
      if (!Number.isNaN(seconds)) retryAfterMs = Math.round(seconds * 1000);
    }

    return { message: err.message, retryable, category, retryAfterMs };
  }

  const message = (err as Error).message ?? String(err);
  const category: AiFailureCategory = /timeout/i.test(message) ? "provider_timeout" : "provider_error";
  return { message, retryable: true, category };
}

/**
 * Phase 4.1 — the real provider selected in place of Anthropic. Same
 * contract, same discipline as anthropicProvider.ts: forced structured
 * output via Gemini's native responseSchema/responseMimeType JSON mode
 * (never free-text parsing), only the minimum fields sent per call, API key
 * read from environment only, never logged.
 */
export const ANALYSIS_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    sentiment: {
      type: Type.OBJECT,
      properties: {
        label: { type: Type.STRING, enum: ["positive", "neutral", "negative"] },
        confidence: { type: Type.NUMBER },
      },
      required: ["label", "confidence"],
    },
    themes: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          theme: { type: Type.STRING, enum: [...THEME_VOCABULARY] },
          confidence: { type: Type.NUMBER },
          evidence: { type: Type.STRING },
        },
        required: ["theme", "confidence", "evidence"],
      },
    },
  },
  required: ["sentiment", "themes"],
};

export const NARRATOR_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    summary: { type: Type.STRING },
    // Phase 4.1 remediation (numerical-claim grounding) — structural home
    // for any number also stated in prose, so it can be deterministically
    // verified against the real evidence package rather than trusted as-is.
    citedMetrics: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          field: { type: Type.STRING, enum: [...CITABLE_METRIC_FIELDS] },
          statedValue: { type: Type.NUMBER },
        },
        required: ["field", "statedValue"],
      },
    },
    rootCause: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          // Phase 10 AI Product Analyst intent/context correction — relaxed
          // from a fixed enum so a genuinely-discovered aspect can be named;
          // re-validated deterministically in narrator.ts, never trusted raw.
          theme: { type: Type.STRING, maxLength: 80 },
          explanation: { type: Type.STRING },
          evidenceReviewIds: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ["theme", "explanation", "evidenceReviewIds"],
      },
    },
    recommendations: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          reason: { type: Type.STRING },
          evidenceReviewIds: { type: Type.ARRAY, items: { type: Type.STRING } },
          confidence: { type: Type.NUMBER },
          // Phase 4.1 remediation item 1 — set this when the recommendation
          // addresses a specific theme, so its citations get the same
          // deterministic relevance check rootCause citations get. Omit/null
          // for a general recommendation not tied to one theme.
          theme: { type: Type.STRING, maxLength: 80, nullable: true },
        },
        required: ["reason", "evidenceReviewIds", "confidence"],
      },
    },
  },
  required: ["summary", "rootCause", "recommendations"],
};

/**
 * Phase 10 semantic-query-understanding — mirrors openaiProvider.ts's
 * QUERY_RESOLUTION_TOOL exactly, adapted to Gemini's Type-based
 * responseSchema shape. Same closed action enum, same source of truth
 * (QUERY_ACTIONS).
 */
export const QUERY_RESOLUTION_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    action: { type: Type.STRING, enum: [...QUERY_ACTIONS] },
    timeframeDescriptor: {
      type: Type.OBJECT,
      properties: {
        type: { type: Type.STRING, enum: ["RELATIVE", "ABSOLUTE", "NAMED", "NONE"] },
        value: { type: Type.NUMBER, nullable: true },
        unit: { type: Type.STRING, enum: ["day", "week", "month", "year"], nullable: true },
        start: { type: Type.STRING, nullable: true },
        end: { type: Type.STRING, nullable: true },
        name: { type: Type.STRING, nullable: true },
      },
      required: ["type"],
    },
    sentiment: { type: Type.STRING, enum: ["positive", "negative", "neutral"], nullable: true },
    quantity: { type: Type.NUMBER, nullable: true },
    aspect: { type: Type.STRING, maxLength: 80, nullable: true },
    contextReference: { type: Type.BOOLEAN },
    responseStyle: { type: Type.STRING, enum: ["CONCISE", "DETAILED", "DEFAULT"] },
    reasoning: { type: Type.STRING, maxLength: 500 },
  },
  required: ["action", "timeframeDescriptor", "sentiment", "quantity", "aspect", "contextReference", "responseStyle", "reasoning"],
};

const QUERY_RESOLUTION_PREFIX = QUERY_RESOLUTION_SYSTEM_PROMPT + "\n\n";

export class GeminiProvider implements AiProvider {
  readonly name = "gemini";
  readonly modelVersion: string;
  private readonly client: GoogleGenAI;
  private readonly model: string;

  constructor(apiKey: string, model: string) {
    if (!apiKey) {
      throw new AiProviderError("gemini", "GEMINI_API_KEY is not configured");
    }
    this.client = new GoogleGenAI({ apiKey });
    this.model = model;
    this.modelVersion = `gemini:${model}:analysis-v1`;
  }

  async analyzeReview(input: AiAnalysisInput): Promise<unknown> {
    try {
      const response = await this.client.models.generateContent({
        model: this.model,
        contents:
          `Analyze this product review.\n` +
          `Rating: ${input.rating}/5\n` +
          `Title: ${input.title ?? "(none)"}\n` +
          `Review: ${input.reviewText ?? "(none)"}`,
        config: {
          responseMimeType: "application/json",
          responseSchema: ANALYSIS_RESPONSE_SCHEMA,
        },
      });

      const text = response.text;
      if (!text) {
        throw new AiProviderError(this.name, "model returned no text content");
      }
      return JSON.parse(text);
    } catch (err) {
      if (err instanceof AiProviderError) throw err;
      const classified = classifyGeminiError(err);
      throw new AiProviderError(this.name, classified.message, {
        retryable: classified.retryable,
        retryAfterMs: classified.retryAfterMs,
        category: classified.category,
      });
    }
  }

  async narrate(
    evidencePackage: ProductEvidencePackage,
    userQuestion?: string,
    analyticalIntent?: AnalyticalIntent,
  ): Promise<unknown> {
    try {
      // Build context from question and intent (Phase 10 Step 3)
      let contextLine = "Explain the following product review evidence.";
      if (userQuestion) {
        contextLine = `Answer the following question based on the product review evidence: "${userQuestion}"`;
      }
      if (analyticalIntent) {
        contextLine += ` Focus on: ${describeIntent(analyticalIntent)}.`;
        contextLine += recommendationInstructionLine(analyticalIntent);
      }

      const response = await this.client.models.generateContent({
        model: this.model,
        contents:
          `${contextLine} Use language like ` +
          `"Reviews indicate..." or "Among the analyzed reviews...". Never claim ` +
          `sales causality reviews alone cannot prove. Every root-cause and ` +
          `recommendation must cite canonical_review_id values ONLY from the ` +
          `evidenceReviewIds list below — never invent an ID. The evidence package's ` +
          `reviewThemes field maps each review ID to the themes it is actually known ` +
          `to relate to. A root-cause, or a recommendation with a theme set, may ONLY ` +
          `cite review IDs whose reviewThemes entry contains that exact theme — do not ` +
          `attribute a theme to a review whose reviewThemes entry lacks it or is empty, ` +
          `even if it seems plausible. If no review is grounded for a theme you were ` +
          `about to raise, omit that theme entirely rather than citing ungrounded IDs. ` +
          `Whenever you state a specific number in summary (e.g. a percentage, count, or ` +
          `average) that comes from this evidence package, you MUST also add a matching ` +
          `entry to citedMetrics with the exact field name and value — only these exact ` +
          `field names are valid: ${CITABLE_METRIC_FIELDS.join(", ")}. A number you cannot ` +
          `tie to one of these fields should not be stated as a specific evidence-derived ` +
          `figure at all.\n\n` +
          JSON.stringify(evidencePackage, null, 2),
        config: {
          responseMimeType: "application/json",
          responseSchema: NARRATOR_RESPONSE_SCHEMA,
        },
      });

      const text = response.text;
      if (!text) {
        throw new AiProviderError(this.name, "model returned no text content");
      }
      return JSON.parse(text);
    } catch (err) {
      if (err instanceof AiProviderError) throw err;
      const classified = classifyGeminiError(err);
      throw new AiProviderError(this.name, classified.message, {
        retryable: classified.retryable,
        retryAfterMs: classified.retryAfterMs,
        category: classified.category,
      });
    }
  }

  async analyzeReviewBatch(reviews: ReviewWithText[], prompt: string): Promise<unknown> {
    // Phase 10 Step 3: Gemini batch analysis stub
    // OpenAI is the active provider; this stub ensures interface compliance
    throw new AiProviderError(this.name, "analyzeReviewBatch not implemented for Gemini provider");
  }

  /**
   * Phase 10 semantic-query-understanding — real implementation (not a
   * stub), mirroring narrate()'s native JSON-mode pattern exactly. Code-
   * complete but NOT exercised by execution in this environment: no
   * GEMINI_API_KEY is configured here — flagged explicitly in the phase
   * report rather than claimed as tested.
   */
  async resolveQuery(input: QueryResolutionInput): Promise<unknown> {
    try {
      const response = await this.client.models.generateContent({
        model: this.model,
        contents:
          QUERY_RESOLUTION_PREFIX +
          JSON.stringify(
            {
              userQuestion: input.userQuestion,
              conversationContext: input.conversationContext,
              productContext: input.productContext,
            },
            null,
            2,
          ),
        config: {
          responseMimeType: "application/json",
          responseSchema: QUERY_RESOLUTION_RESPONSE_SCHEMA,
        },
      });

      const text = response.text;
      if (!text) {
        throw new AiProviderError(this.name, "model returned no text content");
      }
      return JSON.parse(text);
    } catch (err) {
      if (err instanceof AiProviderError) throw err;
      const classified = classifyGeminiError(err);
      throw new AiProviderError(this.name, classified.message, {
        retryable: classified.retryable,
        retryAfterMs: classified.retryAfterMs,
        category: classified.category,
      });
    }
  }
}
