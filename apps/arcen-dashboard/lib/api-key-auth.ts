/**
 * SchematicHQ-style external API key authentication.
 *
 * Validates "Authorization: Bearer api_xxx" headers on public v1 routes.
 * Keys are stored as SHA-256 hashes — never in plaintext.
 *
 * Returns the resolved teamId on success, or a 401 NextResponse on failure.
 */

import { createHash, randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit, applyRateLimitHeaders } from "@/lib/rate-limit";

export type ApiKeyContext = {
  teamId: string;
  apiKeyId: string;
};

// ─── Key hashing ─────────────────────────────────────────────────────────────

export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

// ─── Key generation ───────────────────────────────────────────────────────────

export function generateApiKey(): { raw: string; hash: string; prefix: string } {
  const bytes = randomBytes(32);
  const raw = "api_" + bytes.toString("base64url");
  const hash = hashApiKey(raw);
  const prefix = raw.slice(0, 12); // "api_" + 8 chars
  return { raw, hash, prefix };
}

// ─── Auth extraction ──────────────────────────────────────────────────────────

function extractBearerToken(req: NextRequest): string | null {
  const auth = req.headers.get("authorization") ?? req.headers.get("x-api-key");
  if (!auth) return null;
  if (auth.startsWith("Bearer ")) return auth.slice(7).trim();
  // Also accept raw key without Bearer prefix
  if (auth.startsWith("api_")) return auth.trim();
  return null;
}

// ─── Main auth function ───────────────────────────────────────────────────────

export async function requireApiKey(
  req: NextRequest,
  options: {
    rateLimit?: { limit: number; windowMs: number };
  } = {},
): Promise<ApiKeyContext | NextResponse> {
  const raw = extractBearerToken(req);

  if (!raw) {
    return NextResponse.json(
      { error: "Missing API key. Provide Authorization: Bearer api_xxx" },
      { status: 401 },
    );
  }

  if (!raw.startsWith("api_")) {
    return NextResponse.json(
      { error: "Invalid API key format. Keys must start with api_" },
      { status: 401 },
    );
  }

  const hash = hashApiKey(raw);

  const apiKey = await db.schematicApiKey.findUnique({
    where: { keyHash: hash },
    select: { id: true, teamId: true },
  });

  if (!apiKey) {
    return NextResponse.json({ error: "Invalid or revoked API key" }, { status: 401 });
  }

  // Apply per-key rate limiting
  const rl = options.rateLimit ?? { limit: 500, windowMs: 60_000 };
  const result = rateLimit(`apikey:${apiKey.id}`, rl.limit, rl.windowMs);

  if (!result.ok) {
    const headers = new Headers();
    applyRateLimitHeaders(headers, result, rl.limit);
    headers.set("Retry-After", String(Math.ceil((result.resetAt - Date.now()) / 1000)));
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers },
    );
  }

  // Update lastUsedAt in background
  db.schematicApiKey
    .update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return { teamId: apiKey.teamId, apiKeyId: apiKey.id };
}

export function isApiKeyError(val: unknown): val is NextResponse {
  return val instanceof NextResponse;
}
