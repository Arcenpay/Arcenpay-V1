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
import crypto from "crypto";
import { db } from "@/lib/db";
import { evaluateFlag, resolveCompany, type CompanyKeys, type UserKeys } from "@/lib/flag-engine";
import { aggregateUsage } from "@/lib/event-aggregator";
import { requireApiKey, isApiKeyError } from "@/lib/api-key-auth";

// ─── Access Token Resolution ─────────────────────────────────────────────────

async function resolveAccessToken(token: string): Promise<{ teamId: string; companyId: string | null; userId: string | null } | null> {
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const record = await db.embedAccessToken.findFirst({
    where: { tokenHash, expiresAt: { gt: new Date() } },
    select: { teamId: true, companyId: true, userId: true },
  });
  return record ?? null;
}

// ─── Header parsing ────────────────────────────────────────────────────────────

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

// ─── Entitlement allocation from plan metadata ────────────────────────────────

interface EntitlementEntry {
  featureKey: string;
  type: "BOOLEAN" | "NUMERIC" | "UNLIMITED";
  value: boolean | number | null;
  enabled: boolean;
}

async function getAllocationFromPlan(
  teamId: string,
  activePlanId: string,
  featureKey: string,
): Promise<{ allocation: number | null }> {
  const plan = await db.catalogPlan.findFirst({
    where: { id: activePlanId, teamId },
    select: { metadata: true },
  });
  if (!plan?.metadata) return { allocation: null };
  const meta = plan.metadata as { entitlements?: EntitlementEntry[] };
  const entitlement = meta.entitlements?.find((e) => e.featureKey === featureKey);
  if (!entitlement) return { allocation: null };
  if (entitlement.type === "UNLIMITED") return { allocation: null };
  if (entitlement.type === "NUMERIC") return { allocation: Number(entitlement.value) };
  return { allocation: null };
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const featureKey = req.nextUrl.searchParams.get("key");
  if (!featureKey || featureKey.length > 128) {
    return NextResponse.json({ error: "Missing or invalid query param: key" }, { status: 400 });
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
    const tokenCtx = await resolveAccessToken(bearerToken);
    if (!tokenCtx) {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }
    teamId = tokenCtx.teamId;
    companyId = tokenCtx.companyId;
    userId = tokenCtx.userId;
  } else {
    return NextResponse.json({ error: "Authorization required" }, { status: 401 });
  }

  // Evaluate the flag
  const effectiveCompanyKeys: CompanyKeys = companyKeys ?? { id: companyId ?? undefined };
  const effectiveUserKeys: UserKeys | undefined = userKeys ?? (userId ? { id: userId } : undefined);

  const result = await evaluateFlag(teamId, featureKey, effectiveCompanyKeys, effectiveUserKeys);

  const resolvedCompanyId = result.companyId ?? companyId ?? undefined;

  // Determine feature type
  const flagDef = await db.catalogFeatureFlag.findUnique({
    where: { teamId_featureKey: { teamId, featureKey } },
    select: { featureType: true, eventKey: true },
  });

  const isMetered = flagDef?.featureType === "event_based";

  if (!isMetered) {
    return NextResponse.json({
      key: featureKey,
      enabled: result.value,
      reason: result.reason,
    });
  }

  // Metered — fetch allocation + usage
  const company = resolvedCompanyId
    ? await db.arcenCompany.findFirst({
        where: { id: resolvedCompanyId },
        select: { activePlanId: true },
      })
    : null;

  const { allocation } = company?.activePlanId
    ? await getAllocationFromPlan(teamId, company.activePlanId, featureKey)
    : { allocation: null };

  const metricKey = flagDef?.eventKey ?? featureKey;
  const usage = resolvedCompanyId
    ? await aggregateUsage(teamId, resolvedCompanyId, metricKey, "monthly")
    : 0;

  const exceeded = allocation !== null && usage >= allocation;

  return NextResponse.json({
    key: featureKey,
    enabled: result.value,
    reason: result.reason,
    allocation,
    usage,
    exceeded,
  });
}
