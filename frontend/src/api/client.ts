import { env } from "@/config/env";
import { getAuthToken } from "./authToken";
import { ApiClientError, normalizeErrorResponse } from "./errors";

export interface RequestOptions {
  /** Accepts any plain object of primitive-ish fields — the endpoint
   * functions in api/endpoints/*.ts define the real, precise filter types
   * callers see (Platform/Theme/RankingsSort enums, required vs optional
   * fields); this layer only needs to stringify whatever it's given. */
  query?: Record<string, unknown>;
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const url = new URL(path, env.apiBaseUrl);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

/**
 * Phase 7 Step 1 — the single centralized API client. Every request in this
 * app goes through this function: reads VITE_API_BASE_URL (config/env.ts),
 * attaches Authorization here and only here, and always returns either a
 * parsed JSON value or throws a normalized ApiClientError — never a raw
 * fetch Response or a raw thrown exception.
 *
 * Never logs the token or any response body containing it — this function
 * does not log at all, by design (no console.log anywhere in this file).
 */
export async function apiGet<T>(path: string, options?: RequestOptions): Promise<T> {
  const token = getAuthToken();
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(buildUrl(path, options?.query), {
      method: "GET",
      headers,
      signal: options?.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err; // let cancellation propagate as-is
    throw new ApiClientError("network", "Could not reach the API — check your connection or the API server.");
  }

  if (!response.ok) {
    throw await normalizeErrorResponse(response);
  }

  return (await response.json()) as T;
}
