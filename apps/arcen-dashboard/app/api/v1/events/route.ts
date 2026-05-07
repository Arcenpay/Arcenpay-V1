/**
 * GET  /api/v1/events   — List events (dashboard session auth for UI)
 * POST /api/v1/events   — Ingest event (API key auth for external callers)
 *
 * ArcenPay-compatible event ingestion.
 * Supports "track" (usage) and "identify" (company/user upsert) events.
 *
 * Authorization: Bearer api_xxx
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAnyAuth, isAnyAuthError } from "@/lib/require-any-auth";
import { deliverWebhook } from "@/lib/deliver-webhook";
import { requirePermission, isErrorResponse } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { invalidateUsageCache } from "@/lib/event-aggregator";
import { invalidateFlagCache } from "@/lib/flag-cache";
import { resolveEmbedAccessToken } from "@/lib/embed-access-token";
import { touchEntityActivity } from "@/lib/activity";
import { resolveEntitlementResult } from "@/lib/entitlements";
import { Prisma } from "@/src/generated/prisma/client";

// ─── GET: list events for dashboard UI (Clerk session auth) ──────────────────

import { corsHeaders } from "@/lib/cors";

function jsonWithCors(body: unknown, req: NextRequest, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  for (const [key, value] of Object.entries(corsHeaders(req.headers.get("origin")))) {
    headers.set(key, value);
  }
  return NextResponse.json(body, { ...init, headers });
}

function withCors(response: NextResponse, req: NextRequest) {
  for (const [key, value] of Object.entries(corsHeaders(req.headers.get("origin")))) {
    response.headers.set(key, value);
  }
  return response;
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

export async function GET(req: NextRequest) {
  const ctx = await requirePermission("catalog:read");
  if (isErrorResponse(ctx)) return ctx;

  const { team } = ctx;
  const url = req.nextUrl;
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
  const eventType = url.searchParams.get("eventType");
  const companyId = url.searchParams.get("companyId");

  const events = await db.arcenEvent.findMany({
    where: {
      teamId: team.teamId,
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
        where: { id: { in: userIds }, teamId: team.teamId },
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

  return NextResponse.json({
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
  input: CompanyInput & { name?: string },
  traits?: Record<string, unknown>,
): Promise<{ id: string; created: boolean } | null> {
  if (!input.id && !input.wallet && !input.email) return null;

  const walletAddress = input.wallet?.toLowerCase();

  // Find existing company
  const where: Record<string, unknown>[] = [];
  if (input.id) where.push({ teamId, externalId: input.id });
  if (walletAddress) where.push({ teamId, walletAddress });
  if (input.email) where.push({ teamId, email: input.email });

  const existing = await db.arcenCompany.findFirst({
    where: { OR: where },
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
    await db.arcenCompany.update({
      where: { id: existing.id },
      data: updates,
    });
    return { id: existing.id, created: false };
  }

  // Create new company
  const company = await db.arcenCompany.create({
    data: {
      teamId,
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
  companyId: string,
  input: UserInput & { name?: string; email?: string },
  traits?: Record<string, unknown>,
): Promise<{ id: string; created: boolean } | null> {
  if (!input.id && !input.clerk_user_id && !input.wallet && !input.email) return null;

  const walletAddress = input.wallet?.toLowerCase();

  const where: Record<string, unknown>[] = [];
  if (input.id) where.push({ teamId, externalId: input.id });
  if (input.clerk_user_id) where.push({ teamId, clerkUserId: input.clerk_user_id });
  if (walletAddress) where.push({ teamId, walletAddress });
  if (input.email) where.push({ teamId, email: input.email });

  const existing = await db.arcenUser.findFirst({
    where: { OR: where },
    select: { id: true, traits: true },
  });

  if (existing) {
    const mergedTraits = {
      ...(existing.traits as Record<string, unknown>),
      ...(traits ?? {}),
    };
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
    return { id: existing.id, created: false };
  }

  const user = await db.arcenUser.create({
    data: {
      teamId,
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
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  let ctx:
    | {
        teamId: string;
        source: "api_key" | "session" | "access_token";
        companyId?: string | null;
        userId?: string | null;
      }
    | NextResponse;

  if (bearerToken && !bearerToken.startsWith("api_")) {
    const accessToken = await resolveEmbedAccessToken(bearerToken);
    if (!accessToken) {
      return jsonWithCors({ error: "Invalid or expired token" }, req, { status: 401 });
    }
    ctx = {
      teamId: accessToken.teamId,
      source: "access_token",
      companyId: accessToken.companyId,
      userId: accessToken.userId,
    };
  } else {
    ctx = await requireAnyAuth(req);
    if (isAnyAuthError(ctx)) return withCors(ctx, req);
  }

  let body: EventBody;
  try {
    body = await req.json();
  } catch {
    return jsonWithCors({ error: "Invalid JSON body" }, req, { status: 400 });
  }

  if (!body.event_type || !["track", "identify"].includes(body.event_type)) {
    return jsonWithCors(
      { error: "event_type must be 'track' or 'identify'" }, req,
      { status: 400 },
    );
  }

  // ── Field length validation ──────────────────────────────────
  if (body.event_type === "track") {
    const tb = body as TrackEventBody;
    if (tb.name && tb.name.length > 64) {
      return jsonWithCors({ error: "name too long" }, req, { status: 400 });
    }
    if (tb.company?.wallet && !/^0x[0-9a-fA-F]{40}$/.test(tb.company.wallet)) {
      return jsonWithCors({ error: "Invalid wallet address format" }, req, { status: 400 });
    }
    if (tb.company?.email) {
      if (tb.company.email.length > 254) {
        return jsonWithCors({ error: "email too long" }, req, { status: 400 });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(tb.company.email)) {
        return jsonWithCors({ error: "Invalid email format" }, req, { status: 400 });
      }
    }
    if (tb.company?.id && tb.company.id.length > 64) {
      return jsonWithCors({ error: "company id too long" }, req, { status: 400 });
    }
    if (tb.user?.wallet && !/^0x[0-9a-fA-F]{40}$/.test(tb.user.wallet)) {
      return jsonWithCors({ error: "Invalid wallet address format" }, req, { status: 400 });
    }
    if (tb.user?.email) {
      if (tb.user.email.length > 254) {
        return jsonWithCors({ error: "email too long" }, req, { status: 400 });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(tb.user.email)) {
        return jsonWithCors({ error: "Invalid email format" }, req, { status: 400 });
      }
    }
    if (tb.traits !== undefined && (typeof tb.traits !== "object" || tb.traits === null || Array.isArray(tb.traits))) {
      return jsonWithCors({ error: "traits must be a plain object" }, req, { status: 400 });
    }
    if (
      tb.idempotencyKey !== undefined &&
      (typeof tb.idempotencyKey !== "string" || tb.idempotencyKey.length > 128)
    ) {
      return jsonWithCors(
        { error: "idempotencyKey must be a string up to 128 characters" }, req,
        { status: 400 },
      );
    }
  }

  if (body.event_type === "identify") {
    const ib = body as IdentifyEventBody;
    if (ib.company?.wallet && !/^0x[0-9a-fA-F]{40}$/.test(ib.company.wallet)) {
      return jsonWithCors({ error: "Invalid wallet address format" }, req, { status: 400 });
    }
    if (ib.company?.email) {
      if (ib.company.email.length > 254) {
        return jsonWithCors({ error: "email too long" }, req, { status: 400 });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ib.company.email)) {
        return jsonWithCors({ error: "Invalid email format" }, req, { status: 400 });
      }
    }
    if (ib.company?.name && ib.company.name.length > 128) {
      return jsonWithCors({ error: "company name too long" }, req, { status: 400 });
    }
    if (ib.company?.id && ib.company.id.length > 64) {
      return jsonWithCors({ error: "company id too long" }, req, { status: 400 });
    }
    if (ib.user?.email) {
      if (ib.user.email.length > 254) {
        return jsonWithCors({ error: "email too long" }, req, { status: 400 });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ib.user.email)) {
        return jsonWithCors({ error: "Invalid email format" }, req, { status: 400 });
      }
    }
    if (ib.user?.wallet && !/^0x[0-9a-fA-F]{40}$/.test(ib.user.wallet)) {
      return jsonWithCors({ error: "Invalid wallet address format" }, req, { status: 400 });
    }
    if (ib.traits !== undefined && (typeof ib.traits !== "object" || ib.traits === null || Array.isArray(ib.traits))) {
      return jsonWithCors({ error: "traits must be a plain object" }, req, { status: 400 });
    }
  }

  const { teamId } = ctx;

  // ── identify ────────────────────────────────────────────────
  if (body.event_type === "identify") {
    const b = body as IdentifyEventBody;
    let companyId: string | null = null;

    if (b.company) {
      const result = await upsertCompany(teamId, b.company, b.traits);
      companyId = result?.id ?? null;
      if (companyId) {
        invalidateFlagCache(`${teamId}:`);
        if (result?.created) {
          deliverWebhook(teamId, "company.created", {
            companyId,
            externalId: b.company.id ?? null,
          }).catch(() => {});
        }
      }
    }

    let userId: string | null = null;
    if (b.user && companyId) {
      const result = await upsertUser(teamId, companyId, b.user, b.traits);
      userId = result?.id ?? null;
      if (result?.created && companyId) {
        deliverWebhook(teamId, "user.created", { userId, companyId }).catch(() => {});
      }
    }

    return jsonWithCors({ ok: true, data: { companyId, userId } }, req);
  }

  // ── track ────────────────────────────────────────────────────
  const b = body as TrackEventBody;
  if (!b.name) {
    return jsonWithCors({ error: "name is required for track events" }, req, { status: 400 });
  }

  const companyResult = b.company ? await upsertCompany(teamId, b.company) : null;
  const companyId = companyResult?.id ?? ctx.companyId ?? null;
  const userResult =
    b.user && companyId ? await upsertUser(teamId, companyId, b.user) : null;
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

  // ── Entitlement enforcement: reject track events that would exceed limits ──
  // Prevents bypassing the /usage/consume endpoint by directly tracking events.
  if (companyId) {
    // Invalidate caches first so resolveEntitlementResult uses fresh data
    invalidateUsageCache(teamId, companyId, b.name);
    const entitlement = await resolveEntitlementResult({
      teamId,
      companyKeys: {
        id: companyId,
        wallet: b.company?.wallet ?? undefined,
      },
      featureKey: b.name,
    });
    // Block if: metered AND exceeded, OR not enabled at all
    if (
      entitlement &&
      ((entitlement.allocation !== null && entitlement.exceeded) ||
        !entitlement.enabled)
    ) {
      return jsonWithCors(
        { error: entitlement.exceeded
          ? `Usage limit reached for "${b.name}". Upgrade to continue.`
          : `Feature "${b.name}" is not available on your current plan.` },
        req,
        { status: 429 },
      );
    }
  }

  await db.arcenEvent.create({
    data: {
      teamId,
      eventType: "track",
      name: b.name,
      companyId,
      userId,
      traits: traits as unknown as Prisma.InputJsonValue,
    },
  });

  await touchEntityActivity(companyId, userId);

  // Invalidate usage cache so flag checks reflect the new event
  if (companyId) {
    invalidateUsageCache(teamId, companyId, b.name);
    invalidateFlagCache(`${teamId}:`);
  }

  return jsonWithCors({ ok: true, data: { companyId, userId } }, req);
}
