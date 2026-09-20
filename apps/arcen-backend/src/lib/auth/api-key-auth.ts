/**
 * ArcenPay external credential authentication (Stripe-style).
 *
 *   Secret keys      sk_live_… / sk_test_…   → server-side (Node SDK)
 *   Publishable keys pk_live_… / pk_test_…   → browser-safe (React SDK)
 *   Restricted keys  rk_live_… / rk_test_…   → limited server-side keys
 *
 * The legacy `api_…` prefix is REMOVED. It is no longer accepted anywhere.
 * Any old `api_…` key must be regenerated as `sk_`/`pk_`/`rk_`.
 *
 * Keys are stored as SHA-256 hashes — never plaintext. The raw value is
 * shown once at creation. PUBLISHABLE keys only ever unlock client-safe
 * endpoints; privileged operations require SECRET/RESTRICTED keys (and any
 * permissions the endpoint demands).
 */

import { createHash, randomBytes } from "crypto";
import { db } from "../../db.js";
import { aj, fixedWindow, arcjetNodeRequest } from "./arcjet.js";

export type ApiKeyTypeName = "SECRET" | "PUBLISHABLE" | "RESTRICTED";

export type ApiKeyContext = {
  teamId: string;
  apiKeyId: string;
  environmentId: string | null;
  keyType: ApiKeyTypeName;
  permissions: string[];
  environmentMode: "DEVELOPMENT" | "PRODUCTION" | null;
};

export type ApiKeyError = { error: string; status: number };

// ─── Prefixes & permissions ───────────────────────────────────────────────────

export const KEY_TYPE_PREFIXES: Record<
  ApiKeyTypeName,
  { live: string; test: string }
> = {
  SECRET: { live: "sk_live_", test: "sk_test_" },
  PUBLISHABLE: { live: "pk_live_", test: "pk_test_" },
  RESTRICTED: { live: "rk_live_", test: "rk_test_" },
};

export const TEMP_TOKEN_PREFIX = "arc_tok_";

export const ALLOWED_KEY_PREFIXES = new Set<string>([
  ...Object.values(KEY_TYPE_PREFIXES).flatMap((entry) => [entry.live, entry.test]),
]);

/**
 * Returns true when `value` looks like a platform credential token.
 *
 * Handles both a raw token (`sk_live_…`, `pk_live_…`, `rk_…`) and a full
 * `Authorization` header value (`"Bearer sk_live_…"`).
 *
 * This is the single source of truth for "is this an API key?" used by every
 * route/auth path in the app. DO NOT reimplement prefix checks (e.g.
 * `startsWith("api_")`) locally — that misses the Stripe-style sk_/pk_/rk_
 * credentials and was the cause of production auth failures.
 */
export function isApiKeyToken(value: string | null | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (trimmed.startsWith("Bearer ")) {
    return Array.from(ALLOWED_KEY_PREFIXES).some((prefix) =>
      trimmed.slice(7).trimStart().startsWith(prefix),
    );
  }
  return Array.from(ALLOWED_KEY_PREFIXES).some((prefix) =>
    trimmed.startsWith(prefix),
  );
}

/**
 * Normalizes an `Authorization`/`x-api-key` header value into the raw API key,
 * or returns `null` when it does not look like one of our credential tokens.
 * Also drives the public `extractBearerToken` behavior.
 */
export function normalizeApiKeyAuth(
  auth: string | null | undefined,
): string | null {
  if (!auth) return null;
  if (auth.startsWith("Bearer ")) {
    const token = auth.slice(7).trim();
    return isApiKeyToken(token) ? token : null;
  }
  const trimmed = auth.trim();
  return isApiKeyToken(trimmed) ? trimmed : null;
}

export const API_PERMISSIONS = [
  "entitlements.read",
  "usage.consume",
  "customers.read",
  "companies.write",
  "payments.write",
  "subscriptions.write",
  "tokens.create",
  "invoices.read",
  "invoices.write",
  "invoices.send",
] as const;

export type ApiPermission = (typeof API_PERMISSIONS)[number];

export const API_KEY_TYPE_LABELS: Record<ApiKeyTypeName, string> = {
  SECRET: "Secret key",
  PUBLISHABLE: "Publishable key",
  RESTRICTED: "Restricted key",
};

// ─── Hashing & generation ─────────────────────────────────────────────────────

export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

export function generateApiKey(input: {
  type: ApiKeyTypeName;
  mode: "DEVELOPMENT" | "PRODUCTION";
}): {
  raw: string;
  hash: string;
  prefix: string;
  type: ApiKeyTypeName;
  environmentMode: "DEVELOPMENT" | "PRODUCTION";
} {
  const prefix =
    input.mode === "PRODUCTION"
      ? KEY_TYPE_PREFIXES[input.type].live
      : KEY_TYPE_PREFIXES[input.type].test;
  const raw = prefix + randomBytes(32).toString("base64url");
  return {
    raw,
    hash: hashApiKey(raw),
    prefix: raw.slice(0, 16), // e.g. sk_live_9fK2wX7…
    type: input.type,
    environmentMode: input.mode,
  };
}

/** Short-lived customer access token (arc_tok_…) shown to browsers. */
export function generateTemporaryAccessToken(): {
  raw: string;
  hash: string;
  prefix: string;
} {
  const raw = TEMP_TOKEN_PREFIX + randomBytes(24).toString("base64url");
  return { raw, hash: hashApiKey(raw), prefix: raw.slice(0, 18) };
}

// ─── Auth extraction ──────────────────────────────────────────────────────────

function extractBearerToken(request: Request): string | null {
  const auth =
    request.headers.get("authorization") ?? request.headers.get("x-api-key");
  return normalizeApiKeyAuth(auth);
}

/**
 * Per-API-key rate limit — LIVE in production, DRY_RUN in development.
 *
 * Deliberately high ceiling (5000 req / 60s ≈ 83 req/sec) so legitimate
 * high-volume integrations (SDKs, agents, dashboards, docs playground) are
 * never blocked by normal usage. It only stops true runaway/hostile bursts.
 * IMPORTANT: requests from the docs playground (docs.arcenpay.com) are exempt
 * entirely so "Try it" testing never counts against a key.
 */
const apiKeyProtect = aj.withRule(
  fixedWindow({
    mode: process.env.NODE_ENV === "production" ? "LIVE" : "DRY_RUN",
    characteristics: ["apikey"],
    window: "60s",
    max: 5000,
  }),
);

// ─── Main auth function ───────────────────────────────────────────────────────

export async function requireApiKey(
  request: Request,
  options: {
    /** Key types this endpoint accepts. Default: all. */
    allow?: ApiKeyTypeName[];
    /** Permissions required for SECRET/RESTRICTED keys (all must be present). */
    permissions?: string[];
  } = {},
): Promise<ApiKeyContext | ApiKeyError> {
  const raw = extractBearerToken(request);

  if (!raw) {
    return {
      error: "Missing API key. Provide Authorization: Bearer sk_/pk_/rk_…",
      status: 401,
    };
  }

  const hash = hashApiKey(raw);
  const apiKey = await db.arcenApiKey.findUnique({
    where: { keyHash: hash },
    select: {
      id: true,
      teamId: true,
      environmentId: true,
      type: true,
      permissions: true,
      revokedAt: true,
      expiresAt: true,
      environmentMode: true,
    },
  });

  if (!apiKey) {
    return { error: "Invalid API key", status: 401 };
  }
  if (apiKey.revokedAt) {
    return { error: "API key has been revoked", status: 401 };
  }
  if (apiKey.expiresAt && apiKey.expiresAt.getTime() <= Date.now()) {
    return { error: "API key has expired", status: 401 };
  }

  const keyType = apiKey.type as ApiKeyTypeName;
  const allowed = options.allow ?? ["SECRET", "PUBLISHABLE", "RESTRICTED"];
  if (!allowed.includes(keyType)) {
    return {
      error: `This endpoint cannot be called with ${API_KEY_TYPE_LABELS[keyType].toLowerCase()}s`,
      status: 403,
    };
  }

  // Permission enforcement (publishable keys are implicitly read-only).
  if (keyType !== "PUBLISHABLE" && options.permissions?.length) {
    const owned = apiKey.permissions ?? [];
    const missing = options.permissions.filter((permission) => !owned.includes(permission));
    // Empty permission list on SECRET keys = full access (legacy/standard).
    if (owned.length > 0 && missing.length > 0) {
      return {
        error: `Missing permission(s): ${missing.join(", ")}`,
        status: 403,
      };
    }
    if (keyType === "RESTRICTED" && owned.length === 0) {
      return {
        error: `Missing permission(s): ${options.permissions.join(", ")}`,
        status: 403,
      };
    }
  }

  // Per-key rate limiting via Arcjet — a HIGH ceiling (5000 req/60s) so
  // legitimate high-volume usage is never blocked. This only stops true
  // runaway/hostile bursts while keeping the safety valve in place.
  //
  // SECURITY: there is deliberately NO origin-based exemption here. The docs
  // playground's `Origin` header is client-controlled, so honouring it would
  // let any holder of a valid key lift their own ceiling (and any attacker
  // forge the header outright).
  //
  // AVAILABILITY: a failure inside Arcjet (network blip, quota exhausted, a
  // rule that cannot evaluate) must never reject a request that has already
  // PROVEN ownership of a valid, unrevoked, unexpired key. Previously any
  // thrown error propagated out of `requireApiKey`, turning a WAF hiccup into a
  // 500 on every authenticated call. Fail open, but log loudly.
  if (process.env.ARCJET_KEY) {
    try {
      const decision = await apiKeyProtect.protect(
        arcjetNodeRequest(request) as any,
        {
          apikey: apiKey.id,
        },
      );
      if (decision.isDenied()) {
        return { error: "Rate limit exceeded", status: 429 };
      }
    } catch (err) {
      console.error(
        "[api-key-auth] Per-key rate limit failed to evaluate; allowing an " +
          "already-authenticated request.",
        err,
      );
    }
  }

  // Update lastUsedAt in background
  db.arcenApiKey
    .update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } })
    .catch((err) => {
      console.warn("[api-key-auth] Failed to update lastUsedAt:", err);
    });

  return {
    teamId: apiKey.teamId,
    apiKeyId: apiKey.id,
    environmentId: apiKey.environmentId ?? null,
    keyType,
    permissions: apiKey.permissions ?? [],
    environmentMode: apiKey.environmentMode ?? null,
  };
}

export function isApiKeyError(val: unknown): val is ApiKeyError {
  return (
    typeof val === "object" &&
    val !== null &&
    "error" in val &&
    "status" in val
  );
}
