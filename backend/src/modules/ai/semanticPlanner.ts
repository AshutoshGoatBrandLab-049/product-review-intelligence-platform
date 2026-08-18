/**
 * Phase 10 Semantic Planner — produces structured OperationPlans from natural language.
 *
 * Converts user questions into multi-operation execution plans using LLM semantic
 * understanding. Does NOT generate SQL, code, or arbitrary functions — only selects
 * operations from the Phase A registry and chains them together.
 *
 * All output must pass PlanValidator before execution.
 */

import { z } from "zod";
import type { AiProvider } from "./providers/aiProvider.js";
import type { Platform } from "../../types/unifiedReview.js";
import type { OperationPlan, PlanRejection } from "./operationPlan.js";
import { validatePlan } from "./planValidator.js";
import { buildPlanningSystemPrompt, getOperationTypeEnum } from "./planningPrompt.js";

/**
 * Input to the semantic planner.
 */
export interface PlannerInput {
  userQuestion: string;
  platform: Platform;
  sourceProductId: string;
  conversationContext?: {
    priorFinding?: string;
    priorAspect?: string;
    priorReviewIds?: string[];
  };
}

/**
 * The LLM's raw output for operation planning.
 * Must pass through this schema before we accept it.
 */
export const OperationPlanLlmOutputSchema = z.union([
  z.object({
    goal: z.string(),
    operations: z.array(
      z.object({
        id: z.string(),
        type: z.string(), // Will be validated against registry
        params: z.record(z.string(), z.any()),
        dependsOn: z.string().optional(),
      }),
    ),
    resultOperationId: z.string(),
    contextReference: z.boolean(),
    confidence: z.enum(["high", "medium", "low"]),
    reasoning: z.string(),
  }),
  // Fallback for when LLM cannot produce a plan
  z.object({
    cannotPlan: z.literal(true),
    reason: z.string(),
  }),
]);

export type OperationPlanLlmOutput = z.infer<typeof OperationPlanLlmOutputSchema>;

/**
 * Semantic planner result: either a validated plan or a rejection reason.
 */
export type PlannerResult = ValidatedPlanResult | PlannerRejection;

export interface ValidatedPlanResult {
  status: "success";
  plan: OperationPlan;
  validationStatus: "valid";
}

export interface PlannerRejection {
  status: "failure";
  reason: string;
  details?: string;
}

/**
 * Main entry point: convert a natural language question to an OperationPlan.
 *
 * Process:
 * 1. Call LLM with structured output (function calling)
 * 2. Parse response through schema
 * 3. If LLM says "cannotPlan", return rejection
 * 4. Validate plan through PlanValidator
 * 5. If valid, return plan; if invalid, return rejection
 * 6. On any error (provider failure, timeout, malformed output), return rejection
 */
export async function planOperations(
  input: PlannerInput,
  aiProvider: AiProvider,
): Promise<PlannerResult> {
  try {
    if (!aiProvider.planOperations) {
      return {
        status: "failure",
        reason: "AI provider does not support operation planning",
      };
    }

    // Get the LLM's plan
    const rawPlan = await aiProvider.planOperations(input);

    // Parse through schema
    let parsed: OperationPlanLlmOutput;
    try {
      parsed = OperationPlanLlmOutputSchema.parse(rawPlan);
    } catch (error) {
      return {
        status: "failure",
        reason: "LLM output did not match expected schema",
        details: error instanceof Error ? error.message : String(error),
      };
    }

    // Check if LLM decided this question cannot be planned
    if ("cannotPlan" in parsed && parsed.cannotPlan) {
      return {
        status: "failure",
        reason: parsed.reason,
      };
    }

    // Cast to the successful plan shape
    const rawOperationPlan = parsed as z.infer<typeof OperationPlanLlmOutputSchema> & {
      cannotPlan?: undefined;
      goal: string;
      operations: any[];
      resultOperationId: string;
      contextReference: boolean;
      confidence: "high" | "medium" | "low";
      reasoning: string;
    };

    const operationPlan: OperationPlan = {
      goal: rawOperationPlan.goal,
      operations: rawOperationPlan.operations,
      resultOperationId: rawOperationPlan.resultOperationId,
      contextReference: rawOperationPlan.contextReference,
      confidence: rawOperationPlan.confidence,
      reasoning: rawOperationPlan.reasoning,
    };

    // Validate the plan through Phase A validator
    const validation = validatePlan(operationPlan);

    if (validation.validationStatus === "invalid") {
      const rejection = validation as PlanRejection;
      return {
        status: "failure",
        reason: `Plan validation failed: ${rejection.failureReason}`,
        details: rejection.message,
      };
    }

    // Valid plan
    return {
      status: "success",
      plan: operationPlan,
      validationStatus: "valid",
    };
  } catch (error) {
    // Provider error, timeout, or other unexpected failure
    return {
      status: "failure",
      reason: "Semantic planner failed",
      details: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Helper: check if the planner result succeeded.
 */
export function isPlannerSuccess(result: PlannerResult): result is ValidatedPlanResult {
  return result.status === "success";
}

/**
 * Helper: check if the planner result failed.
 */
export function isPlannerFailure(result: PlannerResult): result is PlannerRejection {
  return result.status === "failure";
}
