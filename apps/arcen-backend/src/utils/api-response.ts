import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

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

type ApiErrorOptions = {
  status?: ContentfulStatusCode;
  code?: string;
  detail?: string;
  retryAt?: number;
};

export function apiError(c: Context, error: string, options: ApiErrorOptions = {}) {
  const status = options.status ?? 400;
  const code = options.code ?? "BAD_REQUEST";

  let detail: string | undefined;
  if (options.detail) {
    const firstLine = options.detail.split("\n")[0];
    detail = firstLine.length > 500 ? firstLine.slice(0, 500) + "..." : firstLine;
  }

  return c.json(
    {
      ok: false,
      error,
      code,
      ...(detail ? { detail } : {}),
      ...(options.retryAt ? { retryAt: options.retryAt } : {}),
    } satisfies ApiErrorPayload,
    status,
  );
}

export function apiSuccess<T>(c: Context, data: T, status: ContentfulStatusCode = 200) {
  return c.json({ ok: true, data } satisfies ApiSuccessPayload<T>, status);
}

export function apiInternalError(c: Context, err: unknown) {
  const message = err instanceof Error ? err.message : "Internal server error";
  const isProduction = process.env.NODE_ENV === "production";
  return apiError(c, "Internal server error", {
    status: 500,
    code: "INTERNAL_ERROR",
    detail: isProduction ? undefined : message,
  });
}
