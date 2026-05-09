/**
 * Standardized API error response format.
 *
 * All API routes should use these helpers to ensure consistent error payloads.
 *
 * Usage:
 *   import { apiError, apiSuccess } from "./api-response.js";
 *
 *   return apiError("Plan not found", { status: 404, code: "NOT_FOUND" });
 *   return apiSuccess({ plan }, { status: 201 });
 */

export interface ApiErrorPayload {
  ok: false;
  error: string;
  code: string;
  detail?: string;
  retryAt?: number;
}

export interface ApiSuccessPayload<T = unknown> {
  ok: true;
  data: T;
}

type ApiResponseOptions = {
  status?: number;
  code?: string;
  detail?: string;
  retryAt?: number;
};

/**
 * Return a standardized error response.
 *
 * @param error - Human-readable error message
 * @param options.status - HTTP status code (default: 400)
 * @param options.code - Machine-readable error code slug (e.g. "NOT_FOUND", "INVALID_INPUT")
 * @param options.detail - Additional developer-facing detail (NEVER expose stack traces)
 * @param options.retryAt - Unix timestamp (ms) suggesting when to retry
 */
export function apiError(error: string, options: ApiResponseOptions = {}): Response {
  const status = options.status ?? 400;
  const code = options.code ?? "BAD_REQUEST";

  // Strip stack traces from detail — only return message
  let detail: string | undefined;
  if (options.detail) {
    const firstLine = options.detail.split("\n")[0];
    detail = firstLine.length > 500 ? firstLine.slice(0, 500) + "..." : firstLine;
  }

  return Response.json(
    {
      ok: false,
      error,
      code,
      ...(detail ? { detail } : {}),
      ...(options.retryAt ? { retryAt: options.retryAt } : {}),
    } satisfies ApiErrorPayload,
    { status },
  );
}

/**
 * Return a standardized success response.
 */
export function apiSuccess<T>(data: T, options: { status?: number } = {}): Response {
  return Response.json(
    { ok: true, data } satisfies ApiSuccessPayload<T>,
    { status: options.status ?? 200 },
  );
}

/**
 * Return a standardized internal server error response.
 * NEVER expose raw error details in production.
 */
export function apiInternalError(err: unknown): Response {
  const message = err instanceof Error ? err.message : "Internal server error";
  const isProduction = process.env.NODE_ENV === "production";
  return apiError("Internal server error", {
    status: 500,
    code: "INTERNAL_ERROR",
    detail: isProduction ? undefined : message,
  });
}
