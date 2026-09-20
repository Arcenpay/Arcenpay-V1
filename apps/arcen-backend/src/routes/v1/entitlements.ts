/**
 * GET /api/v1/entitlements
 *
 * Bulk entitlement endpoint for company-aware feature resolution.
 *
 * Auth (either):
 *  A) Bearer <access_token>
 *  B) Bearer sk_/pk_/rk_ + X-Arcen-Company-Keys / X-Arcen-User-Keys
 */

import type { Context } from "hono";
import { type CompanyKeys, type UserKeys } from "../../lib/entitlements/flag-engine.js";
import { requireApiKey, isApiKeyError, isApiKeyToken } from "../../lib/auth/api-key-auth.js";
import { resolveEmbedAccessToken } from "../../lib/entitlements/embed-access-token.js";
import { resolveEntitlementResults } from "../../lib/entitlements/entitlements.js";
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
  return c.json(null, 204 as any, corsHeaders(c.req.header("origin")));
}

export async function GET(c: Context) {
  const authHeader = c.req.header("authorization") ?? "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  let teamId: string;
  let environmentId: string | null = null;
  let companyId: string | null = null;
  let userId: string | null = null;
  let companyKeys: CompanyKeys | undefined;
  let userKeys: UserKeys | undefined;

  if (isApiKeyToken(bearerToken)) {
    const ctx = await requireApiKey(c.req.raw, {
      // Entitlement reads are client-safe: publishable, secret and restricted
      // keys all work (publishable keys are implicitly read-only).
      allow: ["PUBLISHABLE", "SECRET", "RESTRICTED"],
    });
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

  const effectiveCompanyKeys: CompanyKeys = companyKeys ?? {
    internalId: companyId ?? undefined,
    environmentId,
  };
  const effectiveUserKeys: UserKeys | undefined = userKeys ?? (userId
    ? { internalId: userId, environmentId }
    : undefined);

  const result = await resolveEntitlementResults({
    teamId,
    companyKeys: effectiveCompanyKeys,
    userKeys: effectiveUserKeys,
  });

  return jsonWithCors(c, { entitlements: result.entitlements });
}
