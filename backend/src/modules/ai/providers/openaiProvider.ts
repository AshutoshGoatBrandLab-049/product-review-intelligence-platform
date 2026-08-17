import OpenAI, {
  RateLimitError,
  AuthenticationError,
  APIConnectionTimeoutError,
  InternalServerError,
  APIError,
} from "openai";
import { AiProviderError, type AiFailureCategory, type AiProvider } from "./aiProvider.js";
import type { AiAnalysisInput } from "../types.js";
import type { ProductEvidencePackage } from "../evidencePackage.js";
import { CITABLE_METRIC_FIELDS } from "../narrator.js";
import { THEME_VOCABULARY } from "../../../database/appStore/models/reviewTheme.js";

/**
 * Phase 10 — OpenAI provider. Mirrors AnthropicProvider's error classification
 * strategy against OpenAI SDK error classes. Uses function_call (structured output)
 * rather than free-form text, consistent with the analyzer/narrator pattern.
 */
function classifyOpenaiError(err: unknown): { message: string; retryable: boolean; category: AiFailureCategory; retryAfterMs?: number } {
  if (err instanceof RateLimitError) {
    return { message: (err as any).message, retryable: true, category: "provider_rate_limit" };
  }
  if (err instanceof AuthenticationError) {
    return { message: (err as any).message, retryable: false, category: "provider_auth" };
  }
  if (err instanceof APIConnectionTimeoutError) {
    return { message: (err as any).message, retryable: true, category: "provider_timeout" };
  }
  if (err instanceof InternalServerError) {
    return { message: (err as any).message, retryable: true, category: "provider_unavailable" };
  }
  if (err instanceof APIError) {
    return { message: (err as any).message, retryable: false, category: "provider_error" };
  }
  return { message: (err as Error).message ?? String(err), retryable: true, category: "provider_error" };
}

const ANALYSIS_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "record_review_analysis",
    description: "Records the sentiment and theme analysis of a single customer product review.",
    parameters: {
      type: "object",
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
  },
};

const NARRATOR_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "record_evidence_narration",
    description: "Records an evidence-grounded explanation of a product's review data — never invents metrics or review IDs.",
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string", maxLength: 1000 },
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
              theme: { type: "string", enum: [...THEME_VOCABULARY] },
            },
            required: ["reason", "evidenceReviewIds", "confidence"],
          },
        },
      },
      required: ["summary", "rootCause", "recommendations"],
    },
  },
};

export class OpenAiProvider implements AiProvider {
  readonly name = "openai";
  readonly modelVersion: string;
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(apiKey: string, model: string) {
    if (!apiKey) {
      throw new AiProviderError("openai", "OPENAI_API_KEY is not configured");
    }
    this.client = new OpenAI({ apiKey });
    this.modelVersion = `openai:${model}:analysis-v1`;
    this.model = model;
  }

  async analyzeReview(input: AiAnalysisInput): Promise<unknown> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        max_tokens: 1024,
        tools: [ANALYSIS_TOOL],
        tool_choice: { type: "function", function: { name: "record_review_analysis" } },
        messages: [
          {
            role: "user",
            content:
              `Analyze this product review.\n` +
              `Rating: ${input.rating}/5\n` +
              `Title: ${input.title ?? "(none)"}\n` +
              `Review: ${input.reviewText ?? "(none)"}`,
          },
        ],
      });

      const toolCall = response.choices[0]?.message.tool_calls?.[0];
      if (!toolCall || toolCall.type !== "function") {
        throw new AiProviderError(this.name, "model did not return a function call");
      }

      return JSON.parse(toolCall.function.arguments);
    } catch (err) {
      if (err instanceof AiProviderError) throw err;
      const classified = classifyOpenaiError(err);
      throw new AiProviderError(this.name, classified.message, {
        retryable: classified.retryable,
        retryAfterMs: classified.retryAfterMs,
        category: classified.category,
      });
    }
  }

  async narrate(evidencePackage: ProductEvidencePackage): Promise<unknown> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        max_tokens: 1536,
        tools: [NARRATOR_TOOL],
        tool_choice: { type: "function", function: { name: "record_evidence_narration" } },
        messages: [
          {
            role: "user",
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

      const toolCall = response.choices[0]?.message.tool_calls?.[0];
      if (!toolCall || toolCall.type !== "function") {
        throw new AiProviderError(this.name, "model did not return a function call");
      }

      return JSON.parse(toolCall.function.arguments);
    } catch (err) {
      if (err instanceof AiProviderError) throw err;
      const classified = classifyOpenaiError(err);
      throw new AiProviderError(this.name, classified.message, {
        retryable: classified.retryable,
        retryAfterMs: classified.retryAfterMs,
        category: classified.category,
      });
    }
  }
}
