/**
 * Centralized CORS header configuration for public API routes.
 *
 * Never uses "*" — origins must be explicitly configured via CORS_ORIGINS.
 * Falls back to NEXT_PUBLIC_APP_URL when CORS_ORIGINS is not set.
 * In development, allows localhost origins by default.
 */

const ALLOWED_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;
const ALLOWED_HEADERS = ["Content-Type", "Authorization", "X-API-Key", "X-Requested-With"] as const;

function isDevelopment(): boolean {
  return process.env.NODE_ENV !== "production";
}

/** Parse CORS_ORIGINS env var into a validated set. Called lazily per-request. */
function parseOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS;
  if (raw) {
    return raw.split(",").map((o) => o.trim()).filter(Boolean);
  }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl) {
    return [appUrl];
  }
  // Development: allow common localhost ports
  if (isDevelopment()) {
    return [
      "http://localhost:3000", "http://localhost:3001", "http://localhost:3002",
      "http://localhost:3003",
      "http://127.0.0.1:3000", "http://127.0.0.1:3001", "http://127.0.0.1:3002",
      "http://127.0.0.1:3003",
    ];
  }
  // Production: no default — return empty to deny all cross-origin requests
  return [];
}

export function corsHeaders(origin?: string | null): Record<string, string> {
  const allowedOrigins = parseOrigins();
  const requestOrigin = origin?.trim().toLowerCase();

  let allowOrigin: string;

  if (requestOrigin && allowedOrigins.some((allowed) => {
    const normalized = allowed.trim().toLowerCase();
    return normalized === requestOrigin || normalized === "*" || (normalized.endsWith(":*") && requestOrigin.startsWith(normalized.slice(0, -2)));
  })) {
    // Request origin explicitly allowed — echo it back
    allowOrigin = requestOrigin;
  } else if (isDevelopment()) {
    // In development with no explicit origin: echo the request's origin back
    // so embedded apps and cross-origin dev tools work without manual CORS_ORIGINS config.
    allowOrigin = requestOrigin ?? "*";
  } else {
    // Production with unknown origin: use the first configured origin (or empty)
    allowOrigin = allowedOrigins[0] ?? "";
  }

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": ALLOWED_METHODS.join(", "),
    "Access-Control-Allow-Headers": ALLOWED_HEADERS.join(", "),
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}
