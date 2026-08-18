/**
 * Phase 10 Operation Plan — structured multi-operation execution plan with
 * strongly-typed dependencies and semantic meaning.
 *
 * This is what the LLM planner produces: not hardcoded composites, not
 * special-case fields, but a DAG of operations with typed result chaining.
 */

import { z } from "zod";
import {
  ReviewSetSchema,
  AnalysisResultSchema,
  ComparableAnalyticsSchema,
  ComparisonResultSchema,
  EvidenceResultSchema,
  FindingSchema,
  type ReviewSet,
  type AnalysisResult,
  type ComparableAnalytics,
  type ComparisonResult,
  type EvidenceResult,
  type Finding,
} from "./operationRegistry.js";

// Re-export types for convenience
export type { ReviewSet, AnalysisResult, ComparableAnalytics, ComparisonResult, EvidenceResult, Finding };

/**
 * A single operation within a plan.
 * Each operation has:
 * - type: which operation from the registry
 * - params: validated parameters (checked by validator against allowedParams)
 * - id: unique within the plan, used to reference this operation's result
 * - dependsOn: which prior operation (by id) to use as input, if any
 */
export interface Operation {
  /**
   * Unique ID within this plan. Used to reference results in dependsOn.
   * Format: "op_0", "op_1", etc.
   */
  id: string;

  /**
   * Operation type from the registry. Must match OPERATION_REGISTRY.has(type).
   */
  type: string;

  /**
   * Parameters for this operation. Schema validated by PlanValidator against
   * OPERATION_REGISTRY.allowedParams for this type.
   */
  params: Record<string, any>;

  /**
   * (Optional) ID of a prior operation whose result this operation depends on.
   * The result type from that operation must be in this operation's
   * acceptedInputTypes. Format: "op_0", "op_1", etc.
   * If not present, this operation takes no dependency input.
   */
  dependsOn?: string;
}

/**
 * The complete operation plan produced by the semantic planner.
 * Represents what the system intends to do in response to a user question.
 */
export interface OperationPlan {
  /**
   * What the user asked for, in structured form.
   * This guides the planner but is kept separate from the operation list
   * because different user phrasings may produce the same operation plan.
   */
  goal: string;

  /**
   * Array of operations to execute in DAG order.
   * The validator will verify:
   * - no unknown operation types
   * - all parameters match their schema
   * - no cycles
   * - all dependencies are valid (types match)
   * - no missing required parameters
   */
  operations: Operation[];

  /**
   * Which operation produces the final result that should be narrated?
   * Format: "op_N". Tells the executor which operation result to pass to the narrator.
   * Must be a valid operation id in the plan.
   */
  resultOperationId: string;

  /**
   * Did the planner reference prior conversation context to resolve this plan?
   * Used to track context-aware vs fresh classification.
   */
  contextReference: boolean;

  /**
   * How confident is the planner in this plan?
   * Used internally for logging/debugging.
   */
  confidence: "high" | "medium" | "low";

  /**
   * Brief explanation of why the planner chose this operation sequence.
   * Purely for debugging/audit; never shown to user.
   */
  reasoning: string;
}

/**
 * Validated version of a plan — the planner output, but validated to be
 * actually executable. Produced by PlanValidator; consumed by OperationExecutor.
 */
export interface ValidatedPlan extends OperationPlan {
  /** Validation status — always "valid" for a ValidatedPlan. */
  validationStatus: "valid";
}

/**
 * Rejection reason when a plan fails validation.
 * Returned by PlanValidator when the plan cannot be executed.
 */
export interface PlanRejection {
  /** Validation status — always "invalid". */
  validationStatus: "invalid";

  /** Which rule failed. */
  failureReason:
    | "unknown_operation"
    | "missing_required_parameter"
    | "invalid_parameter_type"
    | "invalid_timeframe"
    | "invalid_sentiment"
    | "unsupported_aspect"
    | "impossible_dependency"
    | "circular_dependency"
    | "unsupported_combination"
    | "invalid_result_operation"
    | "plan_too_complex"
    | "unsupported_feature";

  /** Detailed error message. */
  message: string;

  /** Which operation or parameter caused the failure, if applicable. */
  failureLocation?: string;
}

/**
 * Result of executing a single operation.
 * All operation results are tagged with their operation id so the executor
 * can build a map and pass them to downstream operations.
 */
export interface OperationResult {
  /** Which operation produced this result. */
  operationId: string;

  /** The operation type. */
  operationType: string;

  /** Success or failure. */
  status: "success" | "failure";

  /** The result itself. Type depends on operationType. */
  result?: ReviewSet | AnalysisResult | ComparableAnalytics | ComparisonResult | EvidenceResult | Record<string, any>;

  /** Error details if status === "failure". */
  error?: {
    message: string;
    code: string;
  };

  /** Evidence IDs (review IDs) produced by this operation, if any. */
  evidenceReviewIds?: string[];
}

/**
 * Output of the operation executor — the results of running a validated plan.
 */
export interface ExecutionResult {
  /** Whether all operations executed successfully. */
  success: boolean;

  /** Map of operation id → result. */
  operationResults: Map<string, OperationResult>;

  /** The result to be narrated (from resultOperationId). */
  finalResult?: OperationResult;

  /** If execution failed, which operation failed and why. */
  failureOperationId?: string;
  failureMessage?: string;

  /** Evidence IDs collected across all operations. */
  allEvidenceReviewIds: string[];

  /** Total LLM calls made during execution. */
  llmCallsUsed: number;

  /** Execution time in milliseconds. */
  executionTimeMs: number;
}
