/**
 * GET /api/v1/check?key=<featureKey>
 *
 * Unified flag + entitlement check endpoint.
 *
 * Auth (either):
 *  A) Bearer <access_token>  — resolves company/user from EmbedAccessToken record
 *  B) Bearer sk_/pk_/rk_  — API key auth; reads X-Arcen-Company-Keys / X-Arcen-User-Keys headers
 *
 * Returns:
 *  BOOLEAN features: { key, enabled, reason }
 *  NUMERIC/UNLIMITED features: { key, enabled, reason, allocation, usage, exceeded }
 */

import type { Context } from "hono";
import { type CompanyKeys, type UserKeys } from "../../lib/entitlements/flag-engine.js";
import { requireApiKey, isApiKeyError, isApiKeyToken } from "../../lib/auth/api-key-auth.js";
import { resolveEmbedAccessToken } from "../../lib/entitlements/embed-access-token.js";
import { resolveEntitlementResult } from "../../lib/entitlements/entitlements.js";
import { corsHeaders } from "../../middleware/cors.js";

function jsonWithCors(c: Context, body: unknown, status = 200 as any) {
  return c.json(body, status as any, corsHeaders(c.req.header("origin")));
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

export async function OPTIONS(c: Context) {
  return c.json(null, 204 as any as any, corsHeaders(c.req.header("origin")));
}

export async function GET(c: Context) {
  const featureKey = c.req.query("key");
  if (!featureKey || featureKey.length > 128) {
    return jsonWithCors(
      c,
      { error: "Missing or invalid query param: key" },
      400,
    );
  }

  const authHeader = c.req.header("authorization") ?? "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  let teamId: string;
  let environmentId: string | null = null;
  let companyId: string | null = null;
  let userId: string | null = null;
  let companyKeys: CompanyKeys | undefined;
  let userKeys: UserKeys | undefined;

  if (isApiKeyToken(bearerToken)) {
    const ctx = await requireApiKey(c.req.raw);
    if (isApiKeyError(ctx)) {
      return c.json({ ok: false, error: ctx.error }, ctx.status as any);
    }
    teamId = ctx.teamId;
    environmentId = ctx.environmentId ?? null;

    const rawCompanyKeys = parseKeyHeader(c.req.header("x-arcen-company-keys") ?? null);
    const rawUserKeys = parseKeyHeader(c.req.header("x-arcen-user-keys") ?? null);

    companyKeys = {
      id: rawCompanyKeys["id"],
      wallet: rawCompanyKeys["wallet"] ?? rawCompanyKeys["wallet_address"],
      email: rawCompanyKeys["email"],
      environmentId,
    };

    if (!companyKeys.id && !companyKeys.wallet && !companyKeys.email) {
      return jsonWithCors(
        c,
        { error: "At least one company key (id, wallet, or email) is required" },
        400,
      );
    }

    userKeys =
      rawUserKeys["id"] || rawUserKeys["clerk_user_id"] || rawUserKeys["wallet"]
        ? {
            id: rawUserKeys["id"],
            clerkUserId: rawUserKeys["clerk_user_id"],
            wallet: rawUserKeys["wallet"],
            environmentId,
          }
        : undefined;
  } else if (bearerToken) {
    const tokenCtx = await resolveEmbedAccessToken(bearerToken);
    if (!tokenCtx) {
      return jsonWithCors(c, { error: "Invalid or expired token" }, 401);
    }
    teamId = tokenCtx.teamId;
    environmentId = tokenCtx.environmentId;
    companyId = tokenCtx.companyId;
    userId = tokenCtx.userId;
  } else {
    return jsonWithCors(c, { error: "Authorization required" }, 401);
  }

  // Evaluate the flag
  const effectiveCompanyKeys: CompanyKeys = companyKeys ?? {
    internalId: companyId ?? undefined,
    environmentId,
  };
  const effectiveUserKeys: UserKeys | undefined = userKeys ?? (userId
    ? { internalId: userId, environmentId }
    : undefined);
  const result = await resolveEntitlementResult({
    teamId,
    companyKeys: effectiveCompanyKeys,
    userKeys: effectiveUserKeys,
    featureKey,
  });

  return jsonWithCors(c, result);
}
