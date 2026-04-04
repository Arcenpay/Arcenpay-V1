import { NextRequest, NextResponse } from "next/server";
import { requireApiKey, isApiKeyError } from "@/lib/api-key-auth";
import { resolveEmbedAccessToken } from "@/lib/embed-access-token";
import { type CompanyKeys, type UserKeys } from "@/lib/flag-engine";
import {
  consumeMeteredEntitlement,
  ConsumeEntitlementError,
} from "@/lib/usage-consume";

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

export async function POST(req: NextRequest) {
  let body: {
    featureKey?: string;
    traits?: Record<string, unknown>;
    idempotencyKey?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.featureKey || body.featureKey.length > 128) {
    return NextResponse.json(
      { error: "featureKey is required" },
      { status: 400 },
    );
  }

  if (
    body.traits !== undefined &&
    (typeof body.traits !== "object" ||
      body.traits === null ||
      Array.isArray(body.traits))
  ) {
    return NextResponse.json(
      { error: "traits must be a plain object" },
      { status: 400 },
    );
  }

  if (
    body.idempotencyKey !== undefined &&
    (typeof body.idempotencyKey !== "string" || body.idempotencyKey.length > 128)
  ) {
    return NextResponse.json(
      { error: "idempotencyKey must be a string up to 128 characters" },
      { status: 400 },
    );
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const bearerToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : "";

  let teamId: string;
  let companyKeys: CompanyKeys;
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
      id: rawCompanyKeys.id,
      wallet: rawCompanyKeys.wallet ?? rawCompanyKeys.wallet_address,
      email: rawCompanyKeys.email,
    };

    if (!companyKeys.id && !companyKeys.wallet && !companyKeys.email) {
      return NextResponse.json(
        { error: "At least one company key (id, wallet, or email) is required" },
        { status: 400 },
      );
    }

    userKeys =
      rawUserKeys.id || rawUserKeys.clerk_user_id || rawUserKeys.wallet
        ? {
            id: rawUserKeys.id,
            clerkUserId: rawUserKeys.clerk_user_id,
            wallet: rawUserKeys.wallet,
          }
        : undefined;
  } else if (bearerToken) {
    const tokenCtx = await resolveEmbedAccessToken(bearerToken);
    if (!tokenCtx) {
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 401 },
      );
    }

    if (!tokenCtx.companyId) {
      return NextResponse.json(
        { error: "Company context is required" },
        { status: 400 },
      );
    }

    teamId = tokenCtx.teamId;
    companyKeys = { internalId: tokenCtx.companyId };
    userKeys = tokenCtx.userId ? { internalId: tokenCtx.userId } : undefined;
  } else {
    return NextResponse.json({ error: "Authorization required" }, { status: 401 });
  }

  try {
    const result = await consumeMeteredEntitlement({
      teamId,
      companyKeys,
      userKeys,
      featureKey: body.featureKey,
      traits: body.traits,
      idempotencyKey: body.idempotencyKey,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ConsumeEntitlementError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode },
      );
    }

    throw error;
  }
}
