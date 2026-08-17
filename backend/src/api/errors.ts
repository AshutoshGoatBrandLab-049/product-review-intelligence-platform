/**
 * Phase 6 Step 2 — API-layer error types. Every one carries its own HTTP
 * status so the central error-handling middleware (middleware/errorHandler.ts)
 * never has to guess a status code from a message string.
 */
export class ApiError extends Error {
  readonly httpStatus: number;
  readonly code: string;

  constructor(httpStatus: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.httpStatus = httpStatus;
    this.code = code;
  }
}

export class ValidationError extends ApiError {
  constructor(message: string) {
    super(400, "validation_error", message);
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message = "Missing or invalid authentication token") {
    super(401, "unauthorized", message);
  }
}

export class ForbiddenError extends ApiError {
  constructor(message = "Your role does not permit this action") {
    super(403, "forbidden", message);
  }
}

export class NotFoundError extends ApiError {
  constructor(message = "Resource not found") {
    super(404, "not_found", message);
  }
}
