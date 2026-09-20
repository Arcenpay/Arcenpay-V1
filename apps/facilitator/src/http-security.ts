/**
 * Facilitator HTTP security primitives.
 *
 * The facilitator holds a signer key that can move real funds (SessionVault
 * settlements, Autopay renewals) and exposes operational data for every tenant.
 * Two properties matter for every route:
 *
 *   1. Credentials are compared in constant time. `a === b` on a shared secret
 *      short-circuits on the first differing byte, which turns response latency
 *      into a byte-by-byte oracle for the secret.
 *   2. Anything that reads tenant data or can trigger a side effect requires an
 *      operator credential. Relying on CORS or on the endpoint being "obscure"
 *      is not authentication.
 */

import type express from "express";
import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time secret comparison. Both operands are SHA-256 digested first so
 * the comparison is fixed-width (no length leak) and never throws on
 * mismatched input sizes.
 */
export function secureCompare(
  provided: unknown,
  expected: string | null | undefined,
): boolean {
  if (typeof provided !== "string" || typeof expected !== "string") return false;
  if (provided.length === 0 || expected.length === 0) return false;

  const providedDigest = createHash("sha256").update(provided, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}

/** Extracts the token from an `Authorization: Bearer …` header, case-insensitively. */
export function readBearerToken(req: express.Request): string {
  const raw = req.headers.authorization;
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed.toLowerCase().startsWith("bearer ")) return "";
  return trimmed.slice(7).trim();
}

/**
 * Paths that legitimately must NOT require the operator credential because they
 * either carry their own authentication or are pure discovery documents:
 *
 *  - `/api/premium/**`         — x402: payment IS the credential, and it is the
 *                                product being sold. Enforced by `x402Middleware`.
 *  - `/api/telegram/webhook`   — authenticated by Telegram's shared secret
 *                                token header, verified inside the handler.
 */
const PUBLIC_API_PATH_PREFIXES = ["/api/premium", "/api/telegram/webhook"] as const;

export function isPublicApiPath(pathname: string): boolean {
  return PUBLIC_API_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Builds the operator-auth middleware for the entire server.
 *
 * PROTECTED: every `/api/**` route (except the two documented above) plus
 * `/metrics`. That covers webhook delivery logs and replay, usage analytics,
 * session balances, entitlement lookups, settlement/proof state, paymaster
 * evaluation and the agent dispatch inbox — all of which leak tenant data or
 * trigger side effects.
 *
 * PUBLIC: `/health`, `/info` (probe + x402 discovery), `/api/premium/**` and
 * `/api/telegram/webhook`.
 *
 * FAIL CLOSED: if no `FACILITATOR_SECRET` is configured, every protected route
 * is rejected rather than silently opened. A missing secret is a deployment
 * misconfiguration, not a licence to serve anonymous traffic.
 */
export function createOperatorAuthMiddleware(
  getSecret: () => string,
  options: { allowMetricsPublic?: () => boolean } = {},
) {
  return function requireOperatorAuth(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) {
    const pathname = req.path || "";

    const isProtectedPath =
      pathname.startsWith("/api") || pathname === "/metrics";
    if (!isProtectedPath) {
      return next();
    }

    if (isPublicApiPath(pathname)) {
      return next();
    }

    // Prometheus scraping is often performed by an internal collector that has
    // no way to pass a bearer token. It must be explicitly opted into, never
    // assumed — metrics expose tenant ids, queue depths and revenue counters.
    if (
      pathname === "/metrics" &&
      options.allowMetricsPublic?.() === true
    ) {
      return next();
    }

    const secret = getSecret();
    if (!secret) {
      return res.status(503).json({
        ok: false,
        error:
          "FACILITATOR_SECRET is not configured. Operator API endpoints are disabled.",
        code: "OPERATOR_AUTH_UNCONFIGURED",
      });
    }

    if (!secureCompare(readBearerToken(req), secret)) {
      return res.status(401).json({
        ok: false,
        error: "Unauthorized",
        code: "UNAUTHORIZED",
      });
    }

    return next();
  };
}
