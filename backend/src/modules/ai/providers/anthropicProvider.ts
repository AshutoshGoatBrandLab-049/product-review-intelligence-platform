import Anthropic, {
  RateLimitError,
  AuthenticationError,
  PermissionDeniedError,
  APIConnectionTimeoutError,
  InternalServerError,
  APIError,
} from "@anthropic-ai/sdk";
import { AiProviderError, type AiFailureCategory, type AiProvider } from "./aiProvider.js";
import type { AiAnalysisInput } from "../types.js";
import type { ProductEvidencePackage } from "../evidencePackage.js";
import { CITABLE_METRIC_FIELDS } from "../narrator.js";
import { THEME_VOCABULARY } from "../../../database/appStore/models/reviewTheme.js";

/**
 * Phase 4.1 remediation item 2 — mirrors geminiProvider.ts's classifier,
 * against the Anthropic SDK's own distinct error classes (RateLimitError,
 * AuthenticationError, etc. — verified from the installed SDK's type
 * definitions, not assumed) and the standard HTTP `retry-after` header
 * Anthropic's 429 responses carry. Untested against a real key (no
 * ANTHROPIC_API_KEY exists in this environment), so this is UNIT-TEST
 * PROVEN via mocked error instances only, never PROVEN BY EXECUTION against
 * a real Anthropic response.
 */
function classifyAnthropicError(err: unknown): { message: string; retryable: boolean; category: AiFailureCategory; retryAfterMs?: number } {
  if (err instanceof RateLimitError) {
    const retryAfterHeader = err.headers?.get("retry-after");
    const seconds = retryAfterHeader ? Number.parseFloat(retryAfterHeader) : NaN;
    return { message: err.message, retryable: true, category: "provider_rate_limit", retryAfterMs: Number.isNaN(seconds) ? undefined : seconds * 1000 };
  }
  if (err instanceof AuthenticationError || err instanceof PermissionDeniedError) {
    return { message: err.message, retryable: false, category: "provider_auth" };
  }
  if (err instanceof APIConnectionTimeoutError) {
    return { message: err.message, retryable: true, category: "provider_timeout" };
  }
  if (err instanceof InternalServerError) {
    return { message: err.message, retryable: true, category: "provider_unavailable" };
  }
  if (err instanceof APIError) {
    return { message: err.message, retryable: false, category: "provider_error" };
  }
  return { message: (err as Error).message ?? String(err), retryable: true, category: "provider_error" };
}

/**
 * Phase 4 §2/§21 — the real provider. Code-complete but NOT exercised by any
 * test or local validation run in this phase: no ANTHROPIC_API_KEY exists in
 * this environment (confirmed by direct inspection before writing this
 * file). Wiring it up and running it for real is a decision for whoever has
 * a key, not something this session can verify — flagged explicitly in the
 * final report rather than claimed as tested.
 *
 * Uses tool-use (forced structured output) rather than parsing free-form
 * prose, per Phase 4 §6 — the model MUST return arguments matching
 * ANALYSIS_TOOL's input_schema; there's no free-text response to parse.
 */
const ANALYSIS_TOOL = {
  name: "record_review_analysis",
  description: "Records the sentiment and theme analysis of a single customer product review.",
  input_schema: {
    type: "object" as const,
    properties: {
      sentiment: {
        type: "object",
        properties: {
          label: { type: "string", enum: ["positive", "neutral", "negative"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
        required: ["label", "confidence"],
      },
      themes: {
        type: "array",
        maxItems: 5,
        items: {
          type: "object",
          properties: {
            theme: { type: "string", enum: [...THEME_VOCABULARY] },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            evidence: { type: "string", maxLength: 300 },
          },
          required: ["theme", "confidence", "evidence"],
        },
      },
    },
    required: ["sentiment", "themes"],
  },
};

const NARRATOR_TOOL = {
  name: "record_evidence_narration",
  description: "Records an evidence-grounded explanation of a product's review data — never invents metrics or review IDs.",
  input_schema: {
    type: "object" as const,
    properties: {
      summary: { type: "string", maxLength: 1000 },
      // Phase 4.1 remediation (numerical-claim grounding) — structural home
      // for any number also stated in prose, so it can be deterministically
      // verified against the real evidence package rather than trusted as-is.
      citedMetrics: {
        type: "array",
        maxItems: 10,
        items: {
          type: "object",
          properties: {
            field: { type: "string", enum: [...CITABLE_METRIC_FIELDS] },
            statedValue: { type: "number" },
          },
          required: ["field", "statedValue"],
        },
      },
      rootCause: {
        type: "array",
        maxItems: 5,
        items: {
          type: "object",
          properties: {
            theme: { type: "string", enum: [...THEME_VOCABULARY] },
            explanation: { type: "string", maxLength: 500 },
            evidenceReviewIds: { type: "array", maxItems: 10, items: { type: "string" } },
          },
          required: ["theme", "explanation", "evidenceReviewIds"],
        },
      },
      recommendations: {
        type: "array",
        maxItems: 5,
        items: {
          type: "object",
          properties: {
            reason: { type: "string", maxLength: 500 },
            evidenceReviewIds: { type: "array", maxItems: 10, items: { type: "string" } },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            // Phase 4.1 remediation item 1 — set when tied to a specific
            // theme, so its citations get the same relevance check as
            // rootCause. Omit for a general recommendation.
            theme: { type: "string", enum: [...THEME_VOCABULARY] },
          },
          required: ["reason", "evidenceReviewIds", "confidence"],
        },
      },
    },
    required: ["summary", "rootCause", "recommendations"],
  },
};

export class AnthropicProvider implements AiProvider {
  readonly name = "anthropic";
  readonly modelVersion: string;
  private readonly client: Anthropic;

  constructor(apiKey: string, model: string) {
    if (!apiKey) {
      throw new AiProviderError("anthropic", "ANTHROPIC_API_KEY is not configured");
    }
    this.client = new Anthropic({ apiKey });
    this.modelVersion = `anthropic:${model}:analysis-v1`;
    this.model = model;
  }

  private readonly model: string;

  async analyzeReview(input: AiAnalysisInput): Promise<unknown> {
    try {
      const message = await this.client.messages.create({
        model: this.model,
        max_tokens: 1024,
        tools: [ANALYSIS_TOOL],
        tool_choice: { type: "tool", name: ANALYSIS_TOOL.name },
        messages: [
          {
            role: "user",
            // Only the minimum needed fields are sent — never database
            // internals, never other reviews, never credentials (Phase 4 §5).
            content:
              `Analyze this product review.\n` +
              `Rating: ${input.rating}/5\n` +
              `Title: ${input.title ?? "(none)"}\n` +
              `Review: ${input.reviewText ?? "(none)"}`,
          },
        ],
      });

      const toolUse = message.content.find((block) => block.type === "tool_use");
      if (!toolUse || toolUse.type !== "tool_use") {
        throw new AiProviderError(this.name, "model did not return a tool_use block");
      }
      return toolUse.input;
    } catch (err) {
      if (err instanceof AiProviderError) throw err;
      const classified = classifyAnthropicError(err);
      throw new AiProviderError(this.name, classified.message, {
        retryable: classified.retryable,
        retryAfterMs: classified.retryAfterMs,
        category: classified.category,
      });
    }
  }

  async narrate(evidencePackage: ProductEvidencePackage): Promise<unknown> {
    try {
      const message = await this.client.messages.create({
        model: this.model,
        max_tokens: 1536,
        tools: [NARRATOR_TOOL],
        tool_choice: { type: "tool", name: NARRATOR_TOOL.name },
        messages: [
          {
            role: "user",
            // Only the validated evidence package is sent — never raw
            // reviews, never other products' data, never credentials.
            content:
              `Explain the following product review evidence. Use language like ` +
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
          },
        ],
      });

      const toolUse = message.content.find((block) => block.type === "tool_use");
      if (!toolUse || toolUse.type !== "tool_use") {
        throw new AiProviderError(this.name, "model did not return a tool_use block");
      }
      return toolUse.input;
    } catch (err) {
      if (err instanceof AiProviderError) throw err;
      const classified = classifyAnthropicError(err);
      throw new AiProviderError(this.name, classified.message, {
        retryable: classified.retryable,
        retryAfterMs: classified.retryAfterMs,
        category: classified.category,
      });
    }
  }
}
