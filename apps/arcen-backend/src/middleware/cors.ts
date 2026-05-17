/**
 * Centralized CORS configuration for public API routes.
 *
 * Route-level handlers and the app-wide Hono CORS middleware should share the
 * same origin resolution so preflight requests and normal responses stay in
 * sync.
 */

const ALLOWED_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
] as const;

const ALLOWED_HEADERS = [
  "Content-Type",
  "Authorization",
  "X-API-Key",
  "X-Requested-With",
  "X-Embed-Token",
] as const;

const EXPOSE_HEADERS = [
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
] as const;

function normalizeOrigin(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
}

function normalizeConfiguredOrigin(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (trimmed === "*") return "*";
  if (trimmed.endsWith(":*")) {
    return trimmed.toLowerCase();
  }

  return normalizeOrigin(trimmed);
}

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function isTunnelHost(hostname: string): boolean {
  return (
    hostname.endsWith(".ngrok-free.app") ||
    hostname.endsWith(".ngrok.app") ||
    hostname.endsWith(".ngrok.io") ||
    hostname.endsWith(".devtunnels.ms") ||
    hostname.endsWith(".trycloudflare.com")
  );
}

function isDevelopmentOrigin(origin?: string | null): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  if (!origin) return false;

  try {
    const { hostname } = new URL(origin);
    return isLocalHost(hostname) || isTunnelHost(hostname);
  } catch {
    return false;
  }
}

function matchesConfiguredOrigin(requestOrigin: string, allowedOrigin: string): boolean {
  const normalizedAllowed = allowedOrigin.trim().toLowerCase();
  const normalizedRequest = requestOrigin.toLowerCase();

  return (
    normalizedAllowed === "*" ||
    normalizedAllowed === normalizedRequest ||
    (normalizedAllowed.endsWith(":*") &&
      normalizedRequest.startsWith(normalizedAllowed.slice(0, -2)))
  );
}

/** Parse configured origins lazily per-request so env changes are respected. */
function parseOrigins(): string[] {
  const configuredOrigins = process.env.CORS_ORIGINS
    ?.split(",")
    .map((origin) => normalizeConfiguredOrigin(origin))
    .filter((origin): origin is string => Boolean(origin));

  if (configuredOrigins?.length) {
    return configuredOrigins;
  }

  const fallbackOrigins = [
    process.env.DASHBOARD_URL,
    process.env.NEXT_PUBLIC_APP_URL,
  ]
    .map((origin) => normalizeOrigin(origin))
    .filter((origin): origin is string => Boolean(origin));

  if (fallbackOrigins.length) {
    return fallbackOrigins;
  }

  if (process.env.NODE_ENV !== "production") {
    return [
      "http://localhost:3000",
      "http://localhost:3001",
      "http://localhost:3003",
      "http://127.0.0.1:3000",
      "http://127.0.0.1:3001",
      "http://127.0.0.1:3003",
    ];
  }

  return [];
}

export function resolveCorsOrigin(origin?: string | null): string | null {
  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin) return null;

  const configuredOrigins = parseOrigins();
  if (
    configuredOrigins.some((allowedOrigin) =>
      matchesConfiguredOrigin(normalizedOrigin, allowedOrigin),
    )
  ) {
    return normalizedOrigin;
  }

  if (isDevelopmentOrigin(normalizedOrigin)) {
    return normalizedOrigin;
  }

  return null;
}

export function corsHeaders(origin?: string | null): Record<string, string> {
  const allowOrigin = resolveCorsOrigin(origin);

  return {
    ...(allowOrigin
      ? {
          "Access-Control-Allow-Origin": allowOrigin,
          "Access-Control-Allow-Credentials": "true",
        }
      : {}),
    "Access-Control-Allow-Methods": ALLOWED_METHODS.join(", "),
    "Access-Control-Allow-Headers": ALLOWED_HEADERS.join(", "),
    "Access-Control-Expose-Headers": EXPOSE_HEADERS.join(", "),
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}
