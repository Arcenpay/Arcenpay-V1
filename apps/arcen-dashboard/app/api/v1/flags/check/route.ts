/**
 * GET /api/v1/flags/check?key=<featureKey>
 *
 * ArcenPay flag evaluation endpoint.
 * Evaluates a single feature flag for a company/user and returns True or False.
 *
 * Authorization: Bearer api_xxx
 * X-Arcen-Company-Keys: id=xxx,wallet=0x...,email=user@example.com
 * X-Arcen-User-Keys: id=xxx,clerk_user_id=user_xxx,wallet=0x...
 */

import { NextRequest, NextResponse } from "next/server";
import { requireApiKey, isApiKeyError } from "@/lib/api-key-auth";
import { evaluateFlag, type CompanyKeys, type UserKeys } from "@/lib/flag-engine";
import { db } from "@/lib/db";

// ─── Header key parsing ───────────────────────────────────────────────────────
// Parses "id=xxx,wallet=0x...,email=foo@bar.com" into an object

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
  const ctx = await requireApiKey(req, { rateLimit: { limit: 500, windowMs: 60_000 } });
  if (isApiKeyError(ctx)) return ctx;

  const featureKey = req.nextUrl.searchParams.get("key");
  if (!featureKey) {
    return NextResponse.json(
      { error: "Missing required query param: key" },
      { status: 400 },
    );
  }

  if (featureKey.length > 128) {
    return NextResponse.json({ error: "key too long" }, { status: 400 });
  }

  const { teamId } = ctx;

  // Parse company + user key headers
  const rawCompanyKeys = parseKeyHeader(
    req.headers.get("x-arcen-company-keys") ??
    req.headers.get("x-schematic-company-keys"), // backward compat header
  );
  const rawUserKeys = parseKeyHeader(
    req.headers.get("x-arcen-user-keys") ??
    req.headers.get("x-schematic-user-keys"), // backward compat header
  );

  const companyKeys: CompanyKeys = {
    id: rawCompanyKeys["id"],
    wallet: rawCompanyKeys["wallet"] ?? rawCompanyKeys["wallet_address"],
    email: rawCompanyKeys["email"],
  };

  // At least one company key must be provided
  if (!companyKeys.id && !companyKeys.wallet && !companyKeys.email) {
    return NextResponse.json(
      { error: "At least one company key (id, wallet, or email) must be provided" },
      { status: 400 },
    );
  }

  // Validate wallet format if provided
  if (companyKeys.wallet && !/^0x[0-9a-fA-F]{40}$/.test(companyKeys.wallet)) {
    return NextResponse.json({ error: "Invalid wallet address format" }, { status: 400 });
  }

  const userKeys: UserKeys | undefined =
    rawUserKeys["id"] || rawUserKeys["clerk_user_id"] || rawUserKeys["wallet"]
      ? {
          id: rawUserKeys["id"],
          clerkUserId: rawUserKeys["clerk_user_id"],
          wallet: rawUserKeys["wallet"],
        }
      : undefined;

  const result = await evaluateFlag(teamId, featureKey, companyKeys, userKeys);

  // Log the flag check event in background
  if (result.companyId) {
    db.arcenEvent
      .create({
        data: {
          teamId,
          eventType: "flag_check",
          name: featureKey,
          companyId: result.companyId,
          userId: result.userId,
          traits: { value: result.value, reason: result.reason },
        },
      })
      .catch(() => {});
  }

  return NextResponse.json({
    data: {
      flag: result.flag,
      value: result.value,
      reason: result.reason,
    },
  });
}
