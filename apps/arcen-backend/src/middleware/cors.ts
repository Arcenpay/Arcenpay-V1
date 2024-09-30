/**
 * Centralized CORS configuration for public API routes.
 *
 * Route-level handlers and the app-wide Hono CORS middleware should share the
 * same origin resolution so preflight requests and normal responses stay in
 * sync.
 */

export const ALLOWED_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "HEAD",
] as const;

export const ALLOWED_HEADERS = [
  "Content-Type",
  "Authorization",
  "X-API-Key",
  "X-Requested-With",
  "X-Embed-Token",
  "X-Admin-Secret",
  "X-Environment-Id",
  "X-Team-Id",
  "X-Wallet-Address",
  "X-Stellar-Wallet-Address",
  "X-Chain-Id",
  "X-Arcen-Company-Keys",
  "X-Arcen-User-Keys",
  "X-Payment",
  "Accept",
  "Accept-Language",
  "Cookie",
  "Origin",
  "User-Agent",
  "Referer",
  "sentry-trace",
  "baggage",
] as const;

export const EXPOSE_HEADERS = [
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
  "set-cookie",
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

/**
 * Normalizes a configured origin entry.
 *
 * SECURITY: `*` is accepted from configuration ONLY in non-production (a
 * wildcard with `credentials: true` is a credentialed-any-origin policy, i.e.
 * every site on the internet can read authenticated responses). In production a
 * `*` entry is dropped with a warning rather than silently honoured.
 *
 * Port-wildcard entries (`https://host:*`) are intentionally NOT supported —
 * a wildcard port widens trust to every service a developer happens to run on
 * that host, which is how a dev tool becomes a production CORS bypass.
 */
function normalizeConfiguredOrigin(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  if (trimmed === "*") {
    if (process.env.NODE_ENV === "production") {
      console.warn(
        "[cors] Ignoring wildcard '*' entry in CORS_ORIGINS: a credentialed " +
          "wildcard would allow every origin to read authenticated responses.",
      );
      return null;
    }
    return "*";
  }

  // Explicit subdomain pattern, e.g. https://*.arcenpay.com — only ever
  // honoured when the operator configured it explicitly.
  if (trimmed.includes("*.")) {
    const schemeSeparator = trimmed.indexOf("://");
    const scheme = schemeSeparator === -1 ? "" : trimmed.slice(0, schemeSeparator + 3);
    const suffix = trimmed.slice(trimmed.indexOf("*.") + 1).toLowerCase();
    if (!suffix) return null;
    return `${scheme.toLowerCase()}${suffix}`;
  }

  return normalizeOrigin(trimmed);
}

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/**
 * Local development tunnels (ngrok, Cloudflare quick tunnels, dev tunnels).
 *
 * SECURITY: these are ANONYMOUS, PUBLICLY REGISTERABLE hostnames — anyone can
 * start a quick tunnel and receive a `*.trycloudflare.com` origin. They are
 * therefore trusted ONLY outside production.
 */
function isTunnelHost(hostname: string): boolean {
  return (
    hostname.endsWith(".ngrok-free.app") ||
    hostname.endsWith(".ngrok.app") ||
    hostname.endsWith(".ngrok.io") ||
    hostname.endsWith(".devtunnels.ms") ||
    hostname.endsWith(".trycloudflare.com")
  );
}

/**
 * Preview-deployment platforms.
 *
 * SECURITY: `*.vercel.app` / `*.railway.app` are shared public suffixes — ANY
 * third party can deploy `evil.vercel.app`. Trusting the whole suffix with
 * `Access-Control-Allow-Credentials: true` hands every attacker a first-party
 * origin. Trust is therefore opt-in (`CORS_ALLOW_PREVIEW_DEPLOYMENTS=true`) and
 * additionally narrowed by `CORS_PREVIEW_PROJECT_PREFIX` so only the operator's
 * own project slug is accepted.
 */
const ALLOW_PREVIEW_DEPLOYMENTS =
  process.env.CORS_ALLOW_PREVIEW_DEPLOYMENTS?.trim().toLowerCase() === "true" &&
  process.env.NODE_ENV === "production";

const PREVIEW_PROJECT_PREFIX =
  process.env.CORS_PREVIEW_PROJECT_PREFIX?.trim().toLowerCase() || "";

function isPreviewDeploymentOrigin(hostname: string): boolean {
  if (!ALLOW_PREVIEW_DEPLOYMENTS) return false;
  if (!PREVIEW_PROJECT_PREFIX) {
    console.warn(
      "[cors] CORS_ALLOW_PREVIEW_DEPLOYMENTS is enabled but " +
        "CORS_PREVIEW_PROJECT_PREFIX is not set — refusing to trust shared " +
        "preview hostnames.",
    );
    return false;
  }
  const isPreviewSuffix =
    hostname.endsWith(".vercel.app") || hostname.endsWith(".railway.app");
  return isPreviewSuffix && hostname.startsWith(`${PREVIEW_PROJECT_PREFIX}`);
}

/** First-party ArcenPay origins, matched exactly (never by public suffix). */
function isFirstPartyArcenPayOrigin(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return (
    lower === "arcenpay.com" ||
    lower.endsWith(".arcenpay.com") ||
    isLocalHost(lower)
  );
}

function isTrustedPlatformOrigin(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (isFirstPartyArcenPayOrigin(lower)) return true;
  if (isPreviewDeploymentOrigin(lower)) return true;
  // Tunnels are dev-only (see isTunnelHost).
  if (process.env.NODE_ENV !== "production" && isTunnelHost(lower)) return true;
  return false;
}

/**
 * Whether an unconfigured origin may be trusted purely because of the runtime
 * environment. Deliberately NOT "any origin when NODE_ENV !== production":
 * that previously let a staging/dev deployment open credentialed CORS to the
 * whole internet. Only loopback origins are implicitly trusted.
 */
function isDevelopmentOrigin(origin?: string | null): boolean {
  if (!origin) return false;

  try {
    const { hostname } = new URL(origin);
    if (isLocalHost(hostname)) return true;
    return process.env.NODE_ENV !== "production" && isTunnelHost(hostname);
  } catch {
    return false;
  }
}

function matchesConfiguredOrigin(requestOrigin: string, allowedOrigin: string): boolean {
  const normalizedAllowed = allowedOrigin.trim().toLowerCase();
  const normalizedRequest = requestOrigin.toLowerCase();

  if (normalizedAllowed === "*") {
    // Wildcard is only reachable in non-production (see normalizeConfiguredOrigin).
    return process.env.NODE_ENV !== "production";
  }
  if (normalizedAllowed === normalizedRequest) return true;

  // Explicit subdomain pattern: `https://*.arcenpay.com` → suffix `.arcenpay.com`.
  if (normalizedAllowed.includes("*.")) {
    const [scheme, suffix] = normalizedAllowed.split("*.");
    if (!suffix) return false;
    return (
      normalizedRequest.startsWith(scheme) &&
      normalizedRequest.slice(scheme.length).endsWith(suffix)
    );
  }

  return false;
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
    process.env.APP_URL,
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
      "http://localhost:3002",
      "http://localhost:3003",
      "http://127.0.0.1:3000",
      "http://127.0.0.1:3001",
      "http://127.0.0.1:3002",
      "http://127.0.0.1:3003",
    ];
  }

  return [];
}

export function resolveCorsOrigin(origin?: string | null): string | null {
  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin) return null;

  try {
    const { hostname } = new URL(normalizedOrigin);
    if (isTrustedPlatformOrigin(hostname)) {
      return normalizedOrigin;
    }
  } catch {
    // ignore
  }

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

export function corsHeaders(origin?: string | null, requestHeaders?: string | null): Record<string, string> {
  const allowOrigin = resolveCorsOrigin(origin);

  // SECURITY: do NOT blindly reflect Access-Control-Request-Headers back to the
  // caller. Reflecting arbitrary requested headers (with credentials enabled)
  // lets a hostile origin enumerate and use internal headers. Only headers that
  // are on the allow-list are ever advertised; anything else is dropped.
  let allowedHeaders = ALLOWED_HEADERS.join(", ");
  if (requestHeaders) {
    const requested = requestHeaders
      .split(/\s*,\s*/)
      .map((header) => header.trim())
      .filter(Boolean);
    const allowList = new Set(
      ALLOWED_HEADERS.map((header) => header.toLowerCase()),
    );
    const accepted = requested.filter((header) =>
      allowList.has(header.toLowerCase()),
    );
    if (accepted.length > 0) {
      allowedHeaders = Array.from(new Set([...ALLOWED_HEADERS, ...accepted])).join(", ");
    }
  }

  return {
    ...(allowOrigin
      ? {
          "Access-Control-Allow-Origin": allowOrigin,
          "Access-Control-Allow-Credentials": "true",
        }
      : {}),
    "Access-Control-Allow-Methods": ALLOWED_METHODS.join(", "),
    "Access-Control-Allow-Headers": allowedHeaders,
    "Access-Control-Expose-Headers": EXPOSE_HEADERS.join(", "),
    "Access-Control-Max-Age": "86400",
    Vary: "Origin, Access-Control-Request-Headers",
  };
}
