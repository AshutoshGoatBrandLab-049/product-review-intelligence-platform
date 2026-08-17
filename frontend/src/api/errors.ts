import type { ApiErrorBody } from "@/types/api";

/**
 * Phase 7 Step 1 — one normalized error shape for the whole app. Every
 * non-2xx response (and every network failure) becomes one of these before
 * a component ever sees it — no raw fetch/Response/Error ever reaches a
 * component directly.
 */
export type ApiErrorKind =
  | "validation" // 400
  | "unauthorized" // 401
  | "forbidden" // 403
  | "not_found" // 404
  | "rate_limited" // 429
  | "ai_unavailable" // 502/503 (AiProviderError passthrough — ai_* codes)
  | "server" // 500
  | "network"; // fetch itself failed (offline, CORS, etc.) — no response at all

export class ApiClientError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  readonly code: string | null;
  readonly retryable?: boolean;
  readonly retryAfterMs?: number;

  constructor(kind: ApiErrorKind, message: string, options?: { status?: number; code?: string; retryable?: boolean; retryAfterMs?: number }) {
    super(message);
    this.name = "ApiClientError";
    this.kind = kind;
    this.status = options?.status ?? null;
    this.code = options?.code ?? null;
    this.retryable = options?.retryable;
    this.retryAfterMs = options?.retryAfterMs;
  }
}

function kindForStatus(status: number, code: string): ApiErrorKind {
  if (status === 400) return "validation";
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (code.startsWith("ai_")) return "ai_unavailable";
  return "server";
}

/** Parses the backend's real error envelope ({error:{code,message,...}},
 * src/api/middleware/errorHandler.ts) — never guesses a shape. */
export async function normalizeErrorResponse(response: Response): Promise<ApiClientError> {
  let body: ApiErrorBody | null = null;
  try {
    body = (await response.json()) as ApiErrorBody;
  } catch {
    // Non-JSON error body (shouldn't happen against this backend, but a
    // network intermediary — a proxy, a dev-server error page — could
    // still return one) — fall back to a generic message, never throw here.
  }

  const code = body?.error?.code ?? "unknown_error";
  const message = body?.error?.message ?? `Request failed with status ${response.status}`;

  return new ApiClientError(kindForStatus(response.status, code), message, {
    status: response.status,
    code,
    retryable: body?.error?.retryable,
    retryAfterMs: body?.error?.retryAfterMs,
  });
}
