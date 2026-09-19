/**
 * GET  /api/v1/events   — List events (dashboard session auth for UI)
 * POST /api/v1/events   — Ingest event (API key auth for external callers)
 *
 * ArcenPay-compatible event ingestion.
 * Supports "track" (usage) and "identify" (company/user upsert) events.
 *
 * Authorization: Bearer sk_/pk_/rk_
 */

import type { Context } from "hono";
import { requireAnyAuth, isAnyAuthError } from "../../lib/auth/require-any-auth.js";
import { isApiKeyToken } from "../../lib/auth/api-key-auth.js";
import { deliverWebhook } from "../../lib/webhooks/deliver-webhook.js";
import { requirePermission, isErrorResponse } from "../../lib/auth/api-auth.js";
import { db } from "../../db.js";
import { invalidateUsageCache } from "../../lib/platform/event-aggregator.js";
import { invalidateFlagCache } from "../../lib/entitlements/flag-cache.js";
import { resolveEmbedAccessToken } from "../../lib/entitlements/embed-access-token.js";
import { touchEntityActivity } from "../../lib/platform/activity.js";
import { resolveEntitlementResult } from "../../lib/entitlements/entitlements.js";
import { resolveCreditBurnConfig } from "../../lib/billing/usage-credits.js";
import { consumeMeteredEntitlement } from "../../lib/billing/usage-consume.js";
import { normalizeWallet } from "../../lib/billing/utils.js";
import { Prisma } from "../../generated/client/client.js";
import { corsHeaders } from "../../middleware/cors.js";

function jsonWithCors(c: Context, body: unknown, status = 200 as any) {
  return c.json(body, status as any, corsHeaders(c.req.header("origin")));
}

export async function OPTIONS(c: Context) {
  return c.json(null, 204 as any, corsHeaders(c.req.header("origin")));
}

export async function GET(c: Context) {
  const ctx = await requirePermission(c, "catalog:read");
  if (isErrorResponse(ctx)) return c.json({ ok: false, error: ctx.error }, ctx.status as any);

  const { team } = ctx;
  const environmentId = ctx.session.activeEnvironmentId;
  if (!environmentId) {
    return c.json({ error: "No workspace environment selected" }, 409 as any);
  }
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const eventType = c.req.query("eventType");
  const companyId = c.req.query("companyId");

  const events = await db.arcenEvent.findMany({
    where: {
      teamId: team.teamId,
      environmentId,
      ...(eventType ? { eventType } : {}),
      ...(companyId ? { companyId } : {}),
    },
    orderBy: { sentAt: "desc" },
    take: limit,
    include: {
      company: {
        select: { name: true, walletAddress: true, email: true, externalId: true },
      },
    },
  });

  const userIds = [...new Set(events.map((event) => event.userId).filter((id): id is string => !!id))];
  const users = userIds.length
    ? await db.arcenUser.findMany({
        where: {
          id: { in: userIds },
          teamId: team.teamId,
          environmentId,
        },
        select: {
          id: true,
          name: true,
          email: true,
          walletAddress: true,
          externalId: true,
        },
      })
    : [];

  const userById = new Map(users.map((user) => [user.id, user]));

  return c.json({
    data: events.map((event) => ({
      ...event,
      user: event.userId ? userById.get(event.userId) ?? null : null,
    })),
  });
}

interface CompanyInput {
  id?: string;
  wallet?: string;
  email?: string;
}

interface UserInput {
  id?: string;
  clerk_user_id?: string;
  wallet?: string;
  email?: string;
}

interface TrackEventBody {
  event_type: "track";
  name: string;
  company?: CompanyInput;
  user?: UserInput;
  traits?: Record<string, unknown>;
  idempotencyKey?: string;
}

interface IdentifyEventBody {
  event_type: "identify";
  company?: CompanyInput & { name?: string };
  user?: UserInput & { name?: string; email?: string };
  traits?: Record<string, unknown>;
}

type EventBody = TrackEventBody | IdentifyEventBody;

// ─── Company upsert ───────────────────────────────────────────────────────────

async function upsertCompany(
  teamId: string,
  environmentId: string,
  input: CompanyInput & { name?: string },
  traits?: Record<string, unknown>,
): Promise<{ id: string; created: boolean } | null> {
  if (!input.id && !input.wallet && !input.email) return null;

  const walletAddress = normalizeWallet(input.wallet);

  // Find existing company
  const where: Record<string, unknown>[] = [];
  if (input.id) where.push({ externalId: input.id });
  if (walletAddress) where.push({ walletAddress });
  if (input.email) where.push({ email: input.email });

  const existing = await db.arcenCompany.findFirst({
    where: { teamId, environmentId, OR: where },
    select: { id: true, traits: true },
  });

  if (existing) {
    const mergedTraits = {
      ...(existing.traits as Record<string, unknown>),
      ...(traits ?? {}),
    };
    const updates: Prisma.ArcenCompanyUpdateInput = {
      traits: mergedTraits as unknown as Prisma.InputJsonValue,
      lastSeenAt: new Date(),
      ...(input.name ? { name: input.name } : {}),
      ...(walletAddress ? { walletAddress } : {}),
      ...(input.email ? { email: input.email } : {}),
      ...(input.id ? { externalId: input.id } : {}),
    };
    try {
      await db.arcenCompany.update({
        where: { id: existing.id },
        data: updates,
      });
    } catch (err: unknown) {
      const isP2002 =
        err instanceof Error &&
        "code" in err &&
        (err as { code: string }).code === "P2002";
      if (isP2002 && walletAddress) {
        const existingByWallet = await db.arcenCompany.findFirst({
          where: { teamId, environmentId, walletAddress },
          select: { id: true, traits: true },
        });
        if (existingByWallet) {
          const mergedTraitsForWallet = {
            ...(existingByWallet.traits as Record<string, unknown>),
            ...(traits ?? {}),
          };
          await db.arcenCompany.update({
            where: { id: existingByWallet.id },
            data: {
              traits: mergedTraitsForWallet as unknown as Prisma.InputJsonValue,
              lastSeenAt: new Date(),
              ...(input.name ? { name: input.name } : {}),
              ...(input.email ? { email: input.email } : {}),
              ...(input.id ? { externalId: input.id } : {}),
            },
          });
          return { id: existingByWallet.id, created: false };
        }
      }
      throw err;
    }
    return { id: existing.id, created: false };
  }

  // Create new company
  const company = await db.arcenCompany.create({
    data: {
      teamId,
      environmentId,
      name: input.name ?? input.email ?? input.wallet ?? input.id ?? "Unknown",
      walletAddress,
      email: input.email,
      externalId: input.id,
      traits: (traits ?? {}) as unknown as Prisma.InputJsonValue,
    },
  });
  return { id: company.id, created: true };
}

// ─── User upsert ──────────────────────────────────────────────────────────────

async function upsertUser(
  teamId: string,
  environmentId: string,
  companyId: string,
  input: UserInput & { name?: string; email?: string },
  traits?: Record<string, unknown>,
): Promise<{ id: string; created: boolean } | null> {
  if (!input.id && !input.clerk_user_id && !input.wallet && !input.email) return null;

  const walletAddress = normalizeWallet(input.wallet);

  const where: Record<string, unknown>[] = [];
  if (input.id) where.push({ externalId: input.id });
  if (input.clerk_user_id) where.push({ clerkUserId: input.clerk_user_id });
  if (walletAddress) where.push({ walletAddress });
  if (input.email) where.push({ email: input.email });

  const existing = await db.arcenUser.findFirst({
    where: { teamId, environmentId, OR: where },
    select: { id: true, traits: true },
  });

  if (existing) {
    const mergedTraits = {
      ...(existing.traits as Record<string, unknown>),
      ...(traits ?? {}),
    };
    try {
      await db.arcenUser.update({
        where: { id: existing.id },
        data: {
          companyId,
          traits: mergedTraits as unknown as Prisma.InputJsonValue,
          lastSeenAt: new Date(),
          ...(input.name ? { name: input.name } : {}),
          ...(input.email ? { email: input.email } : {}),
          ...(walletAddress ? { walletAddress } : {}),
          ...(input.clerk_user_id ? { clerkUserId: input.clerk_user_id } : {}),
          ...(input.id ? { externalId: input.id } : {}),
        },
      });
    } catch (err: unknown) {
      const isP2002 =
        err instanceof Error &&
        "code" in err &&
        (err as { code?: string }).code === "P2002";
      if (isP2002 && walletAddress) {
        const existingByWallet = await db.arcenUser.findFirst({
          where: { teamId, environmentId, walletAddress },
          select: { id: true, traits: true },
        });
        if (existingByWallet) {
          const mergedTraitsForWallet = {
            ...(existingByWallet.traits as Record<string, unknown>),
            ...(traits ?? {}),
          };
          await db.arcenUser.update({
            where: { id: existingByWallet.id },
            data: {
              companyId,
              traits: mergedTraitsForWallet as unknown as Prisma.InputJsonValue,
              lastSeenAt: new Date(),
              ...(input.name ? { name: input.name } : {}),
              ...(input.email ? { email: input.email } : {}),
              ...(input.clerk_user_id ? { clerkUserId: input.clerk_user_id } : {}),
              ...(input.id ? { externalId: input.id } : {}),
            },
          });
          return { id: existingByWallet.id, created: false };
        }
      }
      throw err;
    }
    return { id: existing.id, created: false };
  }

  try {
    const user = await db.arcenUser.create({
      data: {
        teamId,
        environmentId,
        companyId,
        walletAddress,
        clerkUserId: input.clerk_user_id,
        externalId: input.id,
        name: input.name,
        email: input.email,
        traits: (traits ?? {}) as unknown as Prisma.InputJsonValue,
      },
    });
    return { id: user.id, created: true };
  } catch (err: unknown) {
    const isP2002 =
      err instanceof Error &&
      "code" in err &&
      (err as { code?: string }).code === "P2002";
    if (isP2002) {
      const existingByWallet = walletAddress
        ? await db.arcenUser.findFirst({
            where: { teamId, environmentId, walletAddress },
            select: { id: true },
          })
        : null;
      const existingById = input.id
        ? await db.arcenUser.findFirst({
            where: { teamId, environmentId, externalId: input.id },
            select: { id: true },
          })
        : null;
      const found = existingByWallet ?? existingById;
      if (found) {
        return { id: found.id, created: false };
      }
    }
    throw err;
  }
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(c: Context) {
  const authHeader = c.req.header("authorization") ?? "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  let ctx:
    {
      teamId: string;
      source: "api_key" | "session" | "access_token";
      companyId?: string | null;
      userId?: string | null;
      activeEnvironmentId?: string | null;
    };

  if (bearerToken && !isApiKeyToken(bearerToken)) {
    const accessToken = await resolveEmbedAccessToken(bearerToken);
    if (!accessToken) {
      return jsonWithCors(c, { error: "Invalid or expired token" }, 401);
    }
    ctx = {
      teamId: accessToken.teamId,
        source: "access_token",
        companyId: accessToken.companyId,
        userId: accessToken.userId,
        activeEnvironmentId: accessToken.environmentId,
      };
  } else {
    const result = await requireAnyAuth(c);
    if (isAnyAuthError(result)) {
      return c.json({ ok: false, error: result.error }, result.status as any, corsHeaders(c.req.header("origin")));
    }
    ctx = result;
  }

  let body: EventBody;
  try {
    body = await c.req.json();
  } catch {
    return jsonWithCors(c, { error: "Invalid JSON body" }, 400);
  }

  if (!body.event_type || !["track", "identify"].includes(body.event_type)) {
    return jsonWithCors(
      c,
      { error: "event_type must be 'track' or 'identify'" },
      400,
    );
  }

  // ── Field length validation ──────────────────────────────────
  if (body.event_type === "track") {
    const tb = body as TrackEventBody;
    if (tb.name && tb.name.length > 64) {
      return jsonWithCors(c, { error: "name too long" }, 400);
    }
    if (tb.company?.wallet && (typeof tb.company.wallet !== "string" || tb.company.wallet.trim().length === 0 || tb.company.wallet.length > 128)) {
      return jsonWithCors(c, { error: "Invalid wallet address format" }, 400);
    }
    if (tb.company?.email) {
      if (tb.company.email.length > 254) {
        return jsonWithCors(c, { error: "email too long" }, 400);
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(tb.company.email)) {
        return jsonWithCors(c, { error: "Invalid email format" }, 400);
      }
    }
    if (tb.company?.id && tb.company.id.length > 64) {
      return jsonWithCors(c, { error: "company id too long" }, 400);
    }
    if (tb.user?.wallet && (typeof tb.user.wallet !== "string" || tb.user.wallet.trim().length === 0 || tb.user.wallet.length > 128)) {
      return jsonWithCors(c, { error: "Invalid wallet address format" }, 400);
    }
    if (tb.user?.email) {
      if (tb.user.email.length > 254) {
        return jsonWithCors(c, { error: "email too long" }, 400);
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(tb.user.email)) {
        return jsonWithCors(c, { error: "Invalid email format" }, 400);
      }
    }
    if (tb.traits !== undefined && (typeof tb.traits !== "object" || tb.traits === null || Array.isArray(tb.traits))) {
      return jsonWithCors(c, { error: "traits must be a plain object" }, 400);
    }
    if (
      tb.idempotencyKey !== undefined &&
      (typeof tb.idempotencyKey !== "string" || tb.idempotencyKey.length > 128)
    ) {
      return jsonWithCors(
        c,
        { error: "idempotencyKey must be a string up to 128 characters" },
        400,
      );
    }
  }

  if (body.event_type === "identify") {
    const ib = body as IdentifyEventBody;
    if (ib.company?.wallet && (typeof ib.company.wallet !== "string" || ib.company.wallet.trim().length === 0 || ib.company.wallet.length > 128)) {
      return jsonWithCors(c, { error: "Invalid wallet address format" }, 400);
    }
    if (ib.company?.email) {
      if (ib.company.email.length > 254) {
        return jsonWithCors(c, { error: "email too long" }, 400);
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ib.company.email)) {
        return jsonWithCors(c, { error: "Invalid email format" }, 400);
      }
    }
    if (ib.company?.name && ib.company.name.length > 128) {
      return jsonWithCors(c, { error: "company name too long" }, 400);
    }
    if (ib.company?.id && ib.company.id.length > 64) {
      return jsonWithCors(c, { error: "company id too long" }, 400);
    }
    if (ib.user?.email) {
      if (ib.user.email.length > 254) {
        return jsonWithCors(c, { error: "email too long" }, 400);
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ib.user.email)) {
        return jsonWithCors(c, { error: "Invalid email format" }, 400);
      }
    }
    if (ib.user?.wallet && (typeof ib.user.wallet !== "string" || ib.user.wallet.trim().length === 0 || ib.user.wallet.length > 128)) {
      return jsonWithCors(c, { error: "Invalid wallet address format" }, 400);
    }
    if (ib.traits !== undefined && (typeof ib.traits !== "object" || ib.traits === null || Array.isArray(ib.traits))) {
      return jsonWithCors(c, { error: "traits must be a plain object" }, 400);
    }
  }

  const { teamId } = ctx;
  const environmentId = ctx.activeEnvironmentId ?? null;
  if (!environmentId) {
    return jsonWithCors(c, { error: "No workspace environment selected" }, 409);
  }

  // ── identify ────────────────────────────────────────────────
  if (body.event_type === "identify") {
    const b = body as IdentifyEventBody;
    let companyId: string | null = null;

    if (b.company) {
      const result = await upsertCompany(
        teamId,
        environmentId,
        b.company,
        b.traits,
      );
      companyId = result?.id ?? null;
      if (companyId) {
        invalidateFlagCache(`${teamId}:`);
        if (result?.created) {
          deliverWebhook(teamId, "company.created", {
            companyId,
            externalId: b.company.id ?? null,
            environmentId,
          }).catch(() => {});
        }
      }
    }

    let userId: string | null = null;
    if (b.user && companyId) {
      const result = await upsertUser(
        teamId,
        environmentId,
        companyId,
        b.user,
        b.traits,
      );
      userId = result?.id ?? null;
      if (result?.created && companyId) {
        deliverWebhook(teamId, "user.created", {
          userId,
          companyId,
          environmentId,
        }).catch(() => {});
      }
    }

    return jsonWithCors(c, { ok: true, data: { companyId, userId } });
  }

  // ── track ────────────────────────────────────────────────────
  const b = body as TrackEventBody;
  if (!b.name) {
    return jsonWithCors(c, { error: "name is required for track events" }, 400);
  }

  const companyResult = b.company
    ? await upsertCompany(teamId, environmentId, b.company)
    : null;
  const companyId = companyResult?.id ?? ctx.companyId ?? null;
  const userResult =
    b.user && companyId
      ? await upsertUser(teamId, environmentId, companyId, b.user)
      : null;
  const userId = userResult?.id ?? ctx.userId ?? null;

  const traits = {
    ...(b.traits ?? {}),
    ...(b.idempotencyKey
      ? {
          __arcen: {
            idempotencyKey: b.idempotencyKey,
            source: "track",
          },
        }
      : {}),
  };
  let enforcedFeatureKey: string | null = null;

  // ── Entitlement enforcement: reject track events that would exceed limits ──
  if (companyId) {
    const trackedFeature = await db.catalogFeatureFlag.findFirst({
      where: {
        teamId,
        OR: [{ featureKey: b.name }, { eventKey: b.name }],
      },
      select: { featureKey: true, featureType: true, eventKey: true },
    });

    if (trackedFeature) {
      enforcedFeatureKey = trackedFeature.featureKey;
      invalidateUsageCache(teamId, companyId, trackedFeature.featureKey);

      const creditBurn = await resolveCreditBurnConfig({
        teamId,
        environmentId,
        featureKey: trackedFeature.featureKey,
      });

      const entitlement = await resolveEntitlementResult({
        teamId,
        companyKeys: {
          internalId: companyId,
          environmentId,
          wallet: b.company?.wallet ?? undefined,
        },
        featureKey: trackedFeature.featureKey,
      });

      const isMetered =
        Boolean(creditBurn) ||
        trackedFeature.featureType === "event_based" ||
        entitlement.allocation !== null;

      if (isMetered) {
        // Use consumeMeteredEntitlement to atomically check limits, burn credits, and create the event
        const result = await consumeMeteredEntitlement({
          teamId,
          companyKeys: {
            internalId: companyId,
            environmentId,
            wallet: b.company?.wallet ?? undefined,
          },
          userKeys: userId ? { internalId: userId, environmentId } : undefined,
          featureKey: trackedFeature.featureKey,
          traits: b.traits,
          idempotencyKey: b.idempotencyKey,
        });

        const meteredResult = result as any;
        if (!meteredResult.consumed) {
          return jsonWithCors(
            c,
            { error: meteredResult.reason || "Limit reached or insufficient credits" },
            meteredResult.reason.includes("Insufficient credits") ? 402 : 429
          );
        }

        return jsonWithCors(c, { ok: true, data: { companyId, userId } });
      }

      // If it's a non-metered feature flag, perform simple Boolean check
      if (entitlement && !entitlement.enabled) {
        return jsonWithCors(
          c,
          { error: `Feature "${trackedFeature.featureKey}" is not available on your current plan.` },
          429,
        );
      }
    }
  }

  await db.arcenEvent.create({
    data: {
      teamId,
      environmentId,
      eventType: "track",
      name: b.name,
      companyId,
      userId,
      traits: traits as unknown as Prisma.InputJsonValue,
    },
  });

  await touchEntityActivity(companyId, userId);

  if (companyId) {
    invalidateUsageCache(teamId, companyId, enforcedFeatureKey ?? b.name);
    invalidateFlagCache(`${teamId}:`);
  }

  return jsonWithCors(c, { ok: true, data: { companyId, userId } });
}
