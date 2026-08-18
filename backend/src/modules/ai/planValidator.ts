/**
 * Phase 10 Plan Validator — deterministic safety checks for operation plans.
 *
 * Validates that a proposed plan is:
 * 1. Syntactically correct (all operations known, all params valid)
 * 2. Semantically executable (no cycles, all dependencies satisfied)
 * 3. Type-safe (result types flow correctly through the DAG)
 * 4. Safe within boundaries (no infinite loops, bounded complexity)
 *
 * This layer is purely deterministic — no AI, no external calls, no state.
 * It either approves the plan or rejects it with a reason.
 */

import type { Operation, OperationPlan, ValidatedPlan, PlanRejection } from "./operationPlan.js";
import {
  OPERATION_REGISTRY,
  getOperationDefinition,
  getSupportedOperationTypes,
  type OperationDefinition,
} from "./operationRegistry.js";

const MAX_PLAN_SIZE = 10; // Don't allow more than 10 operations per plan
const MAX_PLAN_DEPTH = 5; // Don't allow dependency chain deeper than 5

/**
 * Validate a complete operation plan.
 * Returns either ValidatedPlan (success) or PlanRejection (failure with reason).
 */
export function validatePlan(
  plan: OperationPlan,
): ValidatedPlan | PlanRejection {
  // 1. Check plan structure
  const structureError = validatePlanStructure(plan);
  if (structureError) return structureError;

  // 2. Check operations array non-empty
  if (!plan.operations || plan.operations.length === 0) {
    return {
      validationStatus: "invalid",
      failureReason: "invalid_result_operation",
      message: "Plan must contain at least one operation",
    };
  }

  // 3. Check plan size
  if (plan.operations.length > MAX_PLAN_SIZE) {
    return {
      validationStatus: "invalid",
      failureReason: "plan_too_complex",
      message: `Plan contains ${plan.operations.length} operations; maximum is ${MAX_PLAN_SIZE}`,
      failureLocation: `operations.length=${plan.operations.length}`,
    };
  }

  // 4. Check all operations are known
  for (const op of plan.operations) {
    const unknownError = validateOperationExists(op);
    if (unknownError) return unknownError;
  }

  // 5. Check operation IDs are unique
  const idError = validateOperationIds(plan.operations);
  if (idError) return idError;

  // 6. Check result operation exists
  const resultError = validateResultOperation(plan);
  if (resultError) return resultError;

  // 7. Check all dependencies exist and are valid
  const depError = validateDependencies(plan.operations);
  if (depError) return depError;

  // 8. Check for cycles
  const cycleError = detectCycles(plan.operations);
  if (cycleError) return cycleError;

  // 9. Check plan depth
  const depthError = validatePlanDepth(plan.operations);
  if (depthError) return depthError;

  // 10. Validate parameters for each operation
  for (const op of plan.operations) {
    const paramError = validateOperationParameters(op);
    if (paramError) return paramError;
  }

  // 11. Validate type safety of the DAG
  const typeError = validateOperationTypeFlow(plan.operations);
  if (typeError) return typeError;

  // All validations passed
  return {
    ...plan,
    validationStatus: "valid",
  };
}

/**
 * Validate basic plan structure.
 */
function validatePlanStructure(plan: any): PlanRejection | null {
  if (!plan || typeof plan !== "object") {
    return {
      validationStatus: "invalid",
      failureReason: "unsupported_feature",
      message: "Plan must be a valid object",
    };
  }

  if (!plan.goal || typeof plan.goal !== "string") {
    return {
      validationStatus: "invalid",
      failureReason: "unsupported_feature",
      message: "Plan must have a 'goal' string",
    };
  }

  if (!Array.isArray(plan.operations)) {
    return {
      validationStatus: "invalid",
      failureReason: "unsupported_feature",
      message: "Plan.operations must be an array",
    };
  }

  if (!plan.resultOperationId || typeof plan.resultOperationId !== "string") {
    return {
      validationStatus: "invalid",
      failureReason: "invalid_result_operation",
      message: "Plan must have a 'resultOperationId' string",
    };
  }

  return null;
}

/**
 * Validate that an operation type exists in the registry.
 */
function validateOperationExists(op: Operation): PlanRejection | null {
  if (!op.type) {
    return {
      validationStatus: "invalid",
      failureReason: "unknown_operation",
      message: `Operation ${op.id} has no type`,
      failureLocation: op.id,
    };
  }

  if (!OPERATION_REGISTRY.has(op.type)) {
    return {
      validationStatus: "invalid",
      failureReason: "unknown_operation",
      message: `Operation ${op.id} uses unknown type "${op.type}". Supported: ${getSupportedOperationTypes().join(", ")}`,
      failureLocation: op.id,
    };
  }

  return null;
}

/**
 * Validate operation IDs are unique and well-formed.
 */
function validateOperationIds(ops: Operation[]): PlanRejection | null {
  const ids = new Set<string>();

  for (const op of ops) {
    if (!op.id) {
      return {
        validationStatus: "invalid",
        failureReason: "unsupported_feature",
        message: "Every operation must have an id",
        failureLocation: "operations",
      };
    }

    if (ids.has(op.id)) {
      return {
        validationStatus: "invalid",
        failureReason: "unsupported_feature",
        message: `Duplicate operation id: ${op.id}`,
        failureLocation: op.id,
      };
    }

    ids.add(op.id);
  }

  return null;
}

/**
 * Validate that resultOperationId points to an actual operation.
 */
function validateResultOperation(plan: OperationPlan): PlanRejection | null {
  const resultOp = plan.operations.find((op) => op.id === plan.resultOperationId);

  if (!resultOp) {
    return {
      validationStatus: "invalid",
      failureReason: "invalid_result_operation",
      message: `resultOperationId "${plan.resultOperationId}" does not exist in operations`,
      failureLocation: "resultOperationId",
    };
  }

  return null;
}

/**
 * Validate that all dependencies point to existing operations.
 */
function validateDependencies(ops: Operation[]): PlanRejection | null {
  const opIds = new Set(ops.map((op) => op.id));

  for (const op of ops) {
    if (op.dependsOn) {
      if (!opIds.has(op.dependsOn)) {
        return {
          validationStatus: "invalid",
          failureReason: "impossible_dependency",
          message: `Operation ${op.id} depends on non-existent operation "${op.dependsOn}"`,
          failureLocation: op.id,
        };
      }

      // Check that the operation type accepts dependencies
      const def = getOperationDefinition(op.type);
      if (def && !def.acceptsDependency) {
        return {
          validationStatus: "invalid",
          failureReason: "unsupported_combination",
          message: `Operation ${op.id} (type: ${op.type}) does not accept dependencies`,
          failureLocation: op.id,
        };
      }
    }
  }

  return null;
}

/**
 * Detect circular dependencies using DFS.
 */
function detectCycles(ops: Operation[]): PlanRejection | null {
  const adjacency = new Map<string, string | undefined>();
  for (const op of ops) {
    adjacency.set(op.id, op.dependsOn);
  }

  const visited = new Set<string>();
  const stack = new Set<string>();

  function hasCycle(nodeId: string): boolean {
    if (stack.has(nodeId)) return true;
    if (visited.has(nodeId)) return false;

    visited.add(nodeId);
    stack.add(nodeId);

    const dependency = adjacency.get(nodeId);
    if (dependency && hasCycle(dependency)) {
      return true;
    }

    stack.delete(nodeId);
    return false;
  }

  for (const op of ops) {
    if (!visited.has(op.id) && hasCycle(op.id)) {
      return {
        validationStatus: "invalid",
        failureReason: "circular_dependency",
        message: `Circular dependency detected involving operation ${op.id}`,
        failureLocation: op.id,
      };
    }
  }

  return null;
}

/**
 * Validate plan depth (longest dependency chain).
 */
function validatePlanDepth(ops: Operation[]): PlanRejection | null {
  const depths = new Map<string, number>();

  function getDepth(opId: string): number {
    if (depths.has(opId)) return depths.get(opId)!;

    const op = ops.find((o) => o.id === opId);
    if (!op || !op.dependsOn) {
      depths.set(opId, 0);
      return 0;
    }

    const parentDepth = getDepth(op.dependsOn);
    const depth = parentDepth + 1;
    depths.set(opId, depth);
    return depth;
  }

  for (const op of ops) {
    const depth = getDepth(op.id);
    if (depth > MAX_PLAN_DEPTH) {
      return {
        validationStatus: "invalid",
        failureReason: "plan_too_complex",
        message: `Plan depth (${depth}) exceeds maximum (${MAX_PLAN_DEPTH}) at operation ${op.id}`,
        failureLocation: op.id,
      };
    }
  }

  return null;
}

/**
 * Validate that operation parameters match their schema.
 */
function validateOperationParameters(op: Operation): PlanRejection | null {
  const def = getOperationDefinition(op.type);
  if (!def) {
    return {
      validationStatus: "invalid",
      failureReason: "unknown_operation",
      message: `No definition found for operation type ${op.type}`,
      failureLocation: op.id,
    };
  }

  // Check required parameters
  for (const required of def.requiredParams) {
    if (!(required in op.params)) {
      return {
        validationStatus: "invalid",
        failureReason: "missing_required_parameter",
        message: `Operation ${op.id} (${op.type}) missing required parameter "${required}"`,
        failureLocation: `${op.id}.${required}`,
      };
    }
  }

  // Validate parameter schema
  try {
    def.allowedParams.parse(op.params);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      validationStatus: "invalid",
      failureReason: "invalid_parameter_type",
      message: `Operation ${op.id} (${op.type}) parameter validation failed: ${message}`,
      failureLocation: op.id,
    };
  }

  return null;
}

/**
 * Validate that operation result types flow correctly through dependencies.
 * If operation A produces ReviewSet and operation B depends on A,
 * B's acceptedInputTypes must include the operation type that produces ReviewSet.
 */
function validateOperationTypeFlow(ops: Operation[]): PlanRejection | null {
  for (const op of ops) {
    if (!op.dependsOn) continue;

    const def = getOperationDefinition(op.type);
    if (!def) continue;

    const producerOp = ops.find((o) => o.id === op.dependsOn);
    if (!producerOp) continue;

    // Check that the producer's operation type is in the accepted types
    if (!def.acceptedInputTypes.includes(producerOp.type)) {
      return {
        validationStatus: "invalid",
        failureReason: "unsupported_combination",
        message:
          `Operation ${op.id} (${op.type}) cannot accept input from ${producerOp.type}. ` +
          `Accepted input types: ${def.acceptedInputTypes.join(", ") || "none"}`,
        failureLocation: op.id,
      };
    }
  }

  return null;
}
