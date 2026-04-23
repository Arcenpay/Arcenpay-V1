/**
 * GET /api/v1/check?key=<featureKey>
 *
 * Unified flag + entitlement check endpoint.
 *
 * Auth (either):
 *  A) Bearer <access_token>  — resolves company/user from EmbedAccessToken record
 *  B) Bearer api_<key>       — API key auth; reads X-Arcen-Company-Keys / X-Arcen-User-Keys headers
 *
 * Returns:
 *  BOOLEAN features: { key, enabled, reason }
 *  NUMERIC/UNLIMITED features: { key, enabled, reason, allocation, usage, exceeded }
 */

import { NextRequest, NextResponse } from "next/server";
import { type CompanyKeys, type UserKeys } from "@/lib/flag-engine";
import { requireApiKey, isApiKeyError } from "@/lib/api-key-auth";
import { resolveEmbedAccessToken } from "@/lib/embed-access-token";
import { resolveEntitlementResult } from "@/lib/entitlements";

// ─── Header parsing ────────────────────────────────────────────────────────────

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type,Authorization,X-Arcen-Company-Keys,X-Arcen-User-Keys",
  };
}

function jsonWithCors(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  for (const [key, value] of Object.entries(corsHeaders())) {
    headers.set(key, value);
  }
  return NextResponse.json(body, { ...init, headers });
}

function withCors(response: NextResponse) {
  for (const [key, value] of Object.entries(corsHeaders())) {
    response.headers.set(key, value);
  }
  return response;
}

function parseKeyHeader(header: string | null): Record<string, string> {
  if (!header) return {};
  const result: Record<string, string> = {};
  for (const part of header.split(",")) {
    const eqIdx = part.indexOf("=");
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).trim();
    const val = part.slice(eqIdx + 1).trim();
    if (key && val) result[key] = val;
  }
  return result;
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function GET(req: NextRequest) {
  const featureKey = req.nextUrl.searchParams.get("key");
  if (!featureKey || featureKey.length > 128) {
    return jsonWithCors(
      { error: "Missing or invalid query param: key" },
      { status: 400 },
    );
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  let teamId: string;
  let companyId: string | null = null;
  let userId: string | null = null;
  let companyKeys: CompanyKeys | undefined;
  let userKeys: UserKeys | undefined;

  if (bearerToken.startsWith("api_")) {
    const ctx = await requireApiKey(req, { rateLimit: { limit: 500, windowMs: 60_000 } });
    if (isApiKeyError(ctx)) return withCors(ctx);
    teamId = ctx.teamId;

    const rawCompanyKeys = parseKeyHeader(req.headers.get("x-arcen-company-keys"));
    const rawUserKeys = parseKeyHeader(req.headers.get("x-arcen-user-keys"));

    companyKeys = {
      id: rawCompanyKeys["id"],
      wallet: rawCompanyKeys["wallet"] ?? rawCompanyKeys["wallet_address"],
      email: rawCompanyKeys["email"],
    };

    if (!companyKeys.id && !companyKeys.wallet && !companyKeys.email) {
      return jsonWithCors(
        { error: "At least one company key (id, wallet, or email) is required" },
        { status: 400 },
      );
    }

    userKeys =
      rawUserKeys["id"] || rawUserKeys["clerk_user_id"] || rawUserKeys["wallet"]
      ? {
          id: rawUserKeys["id"],
          clerkUserId: rawUserKeys["clerk_user_id"],
          wallet: rawUserKeys["wallet"],
        }
      : undefined;
  } else if (bearerToken) {
    const tokenCtx = await resolveEmbedAccessToken(bearerToken);
    if (!tokenCtx) {
      return jsonWithCors({ error: "Invalid or expired token" }, { status: 401 });
    }
    teamId = tokenCtx.teamId;
    companyId = tokenCtx.companyId;
    userId = tokenCtx.userId;
  } else {
    return jsonWithCors({ error: "Authorization required" }, { status: 401 });
  }

  // Evaluate the flag
  const effectiveCompanyKeys: CompanyKeys = companyKeys ?? {
    internalId: companyId ?? undefined,
  };
  const effectiveUserKeys: UserKeys | undefined = userKeys ?? (userId
    ? { internalId: userId }
    : undefined);
  const result = await resolveEntitlementResult({
    teamId,
    companyKeys: effectiveCompanyKeys,
    userKeys: effectiveUserKeys,
    featureKey,
  });

  return jsonWithCors(result);
}
