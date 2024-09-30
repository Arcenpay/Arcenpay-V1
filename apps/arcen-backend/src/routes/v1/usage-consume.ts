import type { Context } from "hono";
import { requireApiKey, isApiKeyError, isApiKeyToken } from "../../lib/auth/api-key-auth.js";
import { resolveEmbedAccessToken } from "../../lib/entitlements/embed-access-token.js";
import { type CompanyKeys, type UserKeys } from "../../lib/entitlements/flag-engine.js";
import {
  consumeMeteredEntitlement,
  ConsumeEntitlementError,
} from "../../lib/billing/usage-consume.js";
import { corsHeaders } from "../../middleware/cors.js";
import { db } from "../../db.js";

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

export async function POST(c: Context) {
  let body: {
    featureKey?: string;
    traits?: Record<string, unknown>;
    idempotencyKey?: string;
  };

  try {
    body = await c.req.json();
  } catch {
    return jsonWithCors(c, { error: "Invalid JSON body" }, 400);
  }

  if (!body.featureKey || body.featureKey.length > 128) {
    return jsonWithCors(
      c,
      { error: "featureKey is required" },
      400,
    );
  }

  if (
    body.traits !== undefined &&
    (typeof body.traits !== "object" ||
      body.traits === null ||
      Array.isArray(body.traits))
  ) {
    return jsonWithCors(
      c,
      { error: "traits must be a plain object" },
      400,
    );
  }

  if (
    body.idempotencyKey !== undefined &&
    (typeof body.idempotencyKey !== "string" || body.idempotencyKey.length > 128)
  ) {
    return jsonWithCors(
      c,
      { error: "idempotencyKey must be a string up to 128 characters" },
      400,
    );
  }

  const authHeader = c.req.header("authorization") ?? "";
  const bearerToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : "";

  let teamId: string;
  let environmentId: string | null = null;
  let companyKeys: CompanyKeys;
  let userKeys: UserKeys | undefined;

  if (isApiKeyToken(bearerToken)) {
    const ctx = await requireApiKey(c.req.raw);
    if (isApiKeyError(ctx)) {
      return c.json({ ok: false, error: ctx.error }, ctx.status as any, corsHeaders(c.req.header("origin")));
    }

    teamId = ctx.teamId;
    environmentId = ctx.environmentId ?? null;

    const rawCompanyKeys = parseKeyHeader(c.req.header("x-arcen-company-keys") ?? null);
    const rawUserKeys = parseKeyHeader(c.req.header("x-arcen-user-keys") ?? null);

    companyKeys = {
      id: rawCompanyKeys.id,
      wallet: rawCompanyKeys.wallet ?? rawCompanyKeys.wallet_address,
      email: rawCompanyKeys.email,
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
      rawUserKeys.id || rawUserKeys.clerk_user_id || rawUserKeys.wallet
        ? {
            id: rawUserKeys.id,
            clerkUserId: rawUserKeys.clerk_user_id,
            wallet: rawUserKeys.wallet,
            environmentId,
          }
        : undefined;
  } else if (bearerToken) {
    const tokenCtx = await resolveEmbedAccessToken(bearerToken);
    if (!tokenCtx) {
      return jsonWithCors(
        c,
        { error: "Invalid or expired token" },
        401,
      );
    }

    if (!tokenCtx.companyId) {
      return jsonWithCors(
        c,
        { error: "Company context is required" },
        400,
      );
    }

    teamId = tokenCtx.teamId;
    environmentId = tokenCtx.environmentId;
    companyKeys = {
      internalId: tokenCtx.companyId,
      environmentId,
    };
    userKeys = tokenCtx.userId
      ? { internalId: tokenCtx.userId, environmentId }
      : undefined;
  } else {
    return jsonWithCors(c, { error: "Authorization required" }, 401);
  }

  const currentTeam = await db.team.findUnique({
    where: { id: teamId },
    select: { platformTier: true },
  });
  if (!currentTeam || currentTeam.platformTier === "FREE") {
    return jsonWithCors(c, {
      error: "UPGRADE_REQUIRED",
      message: "Usage metering and credit consumption are only available on Growth and Enterprise tiers. Please upgrade your platform billing plan.",
    }, 403);
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

    return jsonWithCors(c, result);
  } catch (error) {
    if (error instanceof ConsumeEntitlementError) {
      return jsonWithCors(
        c,
        { error: error.message },
        error.statusCode,
      );
    }

    throw error;
  }
}
