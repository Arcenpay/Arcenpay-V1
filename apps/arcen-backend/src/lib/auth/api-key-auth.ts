/**
 * ArcenPay external API key authentication.
 *
 * Validates "Authorization: Bearer api_xxx" headers on public v1 routes.
 * Keys are stored as SHA-256 hashes — never in plaintext.
 *
 * Returns the resolved teamId on success, or an error object on failure.
 */

import { createHash, randomBytes } from "crypto";
import { db } from "../../db.js";
import { aj, fixedWindow } from "./arcjet.js";

export type ApiKeyContext = {
  teamId: string;
  apiKeyId: string;
};

export type ApiKeyError = { error: string; status: number };

// ─── Key hashing ─────────────────────────────────────────────────────────────

export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

// ─── Key generation ───────────────────────────────────────────────────────────

export function generateApiKey(): {
  raw: string;
  hash: string;
  prefix: string;
} {
  const bytes = randomBytes(32);
  const raw = "api_" + bytes.toString("base64url");
  const hash = hashApiKey(raw);
  const prefix = raw.slice(0, 12); // "api_" + 8 chars
  return { raw, hash, prefix };
}

// ─── Auth extraction ──────────────────────────────────────────────────────────

function extractBearerToken(request: Request): string | null {
  const auth = request.headers.get("authorization") ?? request.headers.get("x-api-key");
  if (!auth) return null;
  if (auth.startsWith("Bearer ")) return auth.slice(7).trim();
  if (auth.startsWith("api_")) return auth.trim();
  return null;
}

/** Per-API-key rate limit — LIVE in production, DRY_RUN in development */
const apiKeyProtect = aj.withRule(
  fixedWindow({
    mode: process.env.NODE_ENV === "production" ? "LIVE" : "DRY_RUN",
    characteristics: ["apikey"],
    window: "60s",
    max: 500,
  }),
);

// ─── Main auth function ───────────────────────────────────────────────────────

export async function requireApiKey(
  request: Request,
  options: {
    rateLimit?: { limit: number; windowMs: number };
  } = {},
): Promise<ApiKeyContext | ApiKeyError> {
  const raw = extractBearerToken(request);

  if (!raw) {
    return {
      error: "Missing API key. Provide Authorization: Bearer api_xxx",
      status: 401,
    };
  }

  if (!raw.startsWith("api_")) {
    return {
      error: "Invalid API key format. Keys must start with api_",
      status: 401,
    };
  }

  const hash = hashApiKey(raw);

  const apiKey = await db.arcenApiKey.findUnique({
    where: { keyHash: hash },
    select: { id: true, teamId: true },
  });

  if (!apiKey) {
    return {
      error: "Invalid or revoked API key",
      status: 401,
    };
  }

  // Apply per-key rate limiting via Arcjet
  if (process.env.ARCJET_KEY) {
    const decision = await apiKeyProtect.protect(request as any, { apikey: apiKey.id });
    if (decision.isDenied()) {
      return {
        error: "Rate limit exceeded",
        status: 429,
      };
    }
  }

  // Update lastUsedAt in background
  db.arcenApiKey
    .update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return { teamId: apiKey.teamId, apiKeyId: apiKey.id };
}

export function isApiKeyError(val: unknown): val is ApiKeyError {
  return (
    typeof val === "object" &&
    val !== null &&
    "error" in val &&
    "status" in val
  );
}
