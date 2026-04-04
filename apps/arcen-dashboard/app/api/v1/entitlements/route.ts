/**
 * GET /api/v1/entitlements
 *
 * Bulk entitlement endpoint for company-aware feature resolution.
 *
 * Auth (either):
 *  A) Bearer <access_token>
 *  B) Bearer api_<key> + X-Arcen-Company-Keys / X-Arcen-User-Keys
 */

import { NextRequest, NextResponse } from "next/server";
import { type CompanyKeys, type UserKeys } from "@/lib/flag-engine";
import { requireApiKey, isApiKeyError } from "@/lib/api-key-auth";
import { resolveEmbedAccessToken } from "@/lib/embed-access-token";
import { resolveEntitlementResults } from "@/lib/entitlements";

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

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  let teamId: string;
  let companyId: string | null = null;
  let userId: string | null = null;
  let companyKeys: CompanyKeys | undefined;
  let userKeys: UserKeys | undefined;

  if (bearerToken.startsWith("api_")) {
    const ctx = await requireApiKey(req, {
      rateLimit: { limit: 500, windowMs: 60_000 },
    });
    if (isApiKeyError(ctx)) return ctx;

    teamId = ctx.teamId;

    const rawCompanyKeys = parseKeyHeader(req.headers.get("x-arcen-company-keys"));
    const rawUserKeys = parseKeyHeader(req.headers.get("x-arcen-user-keys"));

    companyKeys = {
      id: rawCompanyKeys["id"],
      wallet: rawCompanyKeys["wallet"] ?? rawCompanyKeys["wallet_address"],
      email: rawCompanyKeys["email"],
    };

    if (!companyKeys.id && !companyKeys.wallet && !companyKeys.email) {
      return NextResponse.json(
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
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }

    teamId = tokenCtx.teamId;
    companyId = tokenCtx.companyId;
    userId = tokenCtx.userId;
  } else {
    return NextResponse.json({ error: "Authorization required" }, { status: 401 });
  }

  const effectiveCompanyKeys: CompanyKeys = companyKeys ?? {
    internalId: companyId ?? undefined,
  };
  const effectiveUserKeys: UserKeys | undefined = userKeys ?? (userId
    ? { internalId: userId }
    : undefined);

  const result = await resolveEntitlementResults({
    teamId,
    companyKeys: effectiveCompanyKeys,
    userKeys: effectiveUserKeys,
  });

  return NextResponse.json({ entitlements: result.entitlements });
}
