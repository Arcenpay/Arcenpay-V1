/**
 * GET  /api/v1/events   — List events (dashboard session auth for UI)
 * POST /api/v1/events   — Ingest event (API key auth for external callers)
 *
 * SchematicHQ-compatible event ingestion.
 * Supports "track" (usage) and "identify" (company/user upsert) events.
 *
 * Authorization: Bearer api_xxx
 */

import { NextRequest, NextResponse } from "next/server";
import { requireApiKey, isApiKeyError } from "@/lib/api-key-auth";
import { requirePermission, isErrorResponse } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { invalidateUsageCache } from "@/lib/event-aggregator";
import { invalidateFlagCache } from "@/lib/flag-cache";
import { Prisma } from "@/src/generated/prisma/client";

// ─── GET: list events for dashboard UI (Clerk session auth) ──────────────────

export async function GET(req: NextRequest) {
  const ctx = await requirePermission("catalog:read");
  if (isErrorResponse(ctx)) return ctx;

  const { team } = ctx;
  const url = req.nextUrl;
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
  const eventType = url.searchParams.get("eventType");
  const companyId = url.searchParams.get("companyId");

  const events = await db.schematicEvent.findMany({
    where: {
      teamId: team.teamId,
      ...(eventType ? { eventType } : {}),
      ...(companyId ? { companyId } : {}),
    },
    orderBy: { sentAt: "desc" },
    take: limit,
    include: {
      company: {
        select: { name: true, walletAddress: true },
      },
    },
  });

  return NextResponse.json({ data: events });
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
}

interface TrackEventBody {
  event_type: "track";
  name: string;
  company: CompanyInput;
  user?: UserInput;
  traits?: Record<string, unknown>;
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
): Promise<string | null> {
  if (!input.id && !input.wallet && !input.email) return null;

  const walletAddress = input.wallet?.toLowerCase();

  // Find existing company
  const where: Record<string, unknown>[] = [];
  if (input.id) where.push({ teamId, externalId: input.id });
  if (walletAddress) where.push({ teamId, walletAddress });
  if (input.email) where.push({ teamId, email: input.email });

  const existing = await db.schematicCompany.findFirst({
    where: { OR: where },
    select: { id: true, traits: true },
  });

  if (existing) {
    const mergedTraits = {
      ...(existing.traits as Record<string, unknown>),
      ...(traits ?? {}),
    };
    await db.schematicCompany.update({
      where: { id: existing.id },
      data: { traits: mergedTraits as unknown as Prisma.InputJsonValue, lastSeenAt: new Date() },
    });
    return existing.id;
  }

  // Create new company
  const company = await db.schematicCompany.create({
    data: {
      teamId,
      name: input.name ?? input.email ?? input.wallet ?? input.id ?? "Unknown",
      walletAddress,
      email: input.email,
      externalId: input.id,
      traits: (traits ?? {}) as unknown as Prisma.InputJsonValue,
    },
  });
  return company.id;
}

// ─── User upsert ──────────────────────────────────────────────────────────────

async function upsertUser(
  teamId: string,
  companyId: string,
  input: UserInput & { name?: string; email?: string },
  traits?: Record<string, unknown>,
): Promise<string | null> {
  if (!input.id && !input.clerk_user_id && !input.wallet) return null;

  const walletAddress = input.wallet?.toLowerCase();

  const where: Record<string, unknown>[] = [];
  if (input.id) where.push({ teamId, externalId: input.id });
  if (input.clerk_user_id) where.push({ teamId, clerkUserId: input.clerk_user_id });
  if (walletAddress) where.push({ teamId, walletAddress });

  const existing = await db.schematicUser.findFirst({
    where: { OR: where },
    select: { id: true, traits: true },
  });

  if (existing) {
    const mergedTraits = {
      ...(existing.traits as Record<string, unknown>),
      ...(traits ?? {}),
    };
    await db.schematicUser.update({
      where: { id: existing.id },
      data: {
        traits: mergedTraits as unknown as Prisma.InputJsonValue,
        lastSeenAt: new Date(),
        ...(input.name ? { name: input.name } : {}),
        ...(input.email ? { email: input.email } : {}),
      },
    });
    return existing.id;
  }

  const user = await db.schematicUser.create({
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
  return user.id;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const ctx = await requireApiKey(req, { rateLimit: { limit: 1000, windowMs: 60_000 } });
  if (isApiKeyError(ctx)) return ctx;

  let body: EventBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.event_type || !["track", "identify"].includes(body.event_type)) {
    return NextResponse.json(
      { error: "event_type must be 'track' or 'identify'" },
      { status: 400 },
    );
  }

  // ── Field length validation ──────────────────────────────────
  if (body.event_type === "track") {
    const tb = body as TrackEventBody;
    if (tb.name && tb.name.length > 64) {
      return NextResponse.json({ error: "name too long" }, { status: 400 });
    }
    if (tb.company?.wallet && !/^0x[0-9a-fA-F]{40}$/.test(tb.company.wallet)) {
      return NextResponse.json({ error: "Invalid wallet address format" }, { status: 400 });
    }
    if (tb.company?.email) {
      if (tb.company.email.length > 254) {
        return NextResponse.json({ error: "email too long" }, { status: 400 });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(tb.company.email)) {
        return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
      }
    }
    if (tb.company?.id && tb.company.id.length > 64) {
      return NextResponse.json({ error: "company id too long" }, { status: 400 });
    }
    if (tb.traits !== undefined && (typeof tb.traits !== "object" || tb.traits === null || Array.isArray(tb.traits))) {
      return NextResponse.json({ error: "traits must be a plain object" }, { status: 400 });
    }
  }

  if (body.event_type === "identify") {
    const ib = body as IdentifyEventBody;
    if (ib.company?.wallet && !/^0x[0-9a-fA-F]{40}$/.test(ib.company.wallet)) {
      return NextResponse.json({ error: "Invalid wallet address format" }, { status: 400 });
    }
    if (ib.company?.email) {
      if (ib.company.email.length > 254) {
        return NextResponse.json({ error: "email too long" }, { status: 400 });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ib.company.email)) {
        return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
      }
    }
    if (ib.company?.name && ib.company.name.length > 128) {
      return NextResponse.json({ error: "company name too long" }, { status: 400 });
    }
    if (ib.company?.id && ib.company.id.length > 64) {
      return NextResponse.json({ error: "company id too long" }, { status: 400 });
    }
    if (ib.user?.email) {
      if (ib.user.email.length > 254) {
        return NextResponse.json({ error: "email too long" }, { status: 400 });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ib.user.email)) {
        return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
      }
    }
    if (ib.user?.wallet && !/^0x[0-9a-fA-F]{40}$/.test(ib.user.wallet)) {
      return NextResponse.json({ error: "Invalid wallet address format" }, { status: 400 });
    }
    if (ib.traits !== undefined && (typeof ib.traits !== "object" || ib.traits === null || Array.isArray(ib.traits))) {
      return NextResponse.json({ error: "traits must be a plain object" }, { status: 400 });
    }
  }

  const { teamId } = ctx;

  // ── identify ────────────────────────────────────────────────
  if (body.event_type === "identify") {
    const b = body as IdentifyEventBody;
    let companyId: string | null = null;

    if (b.company) {
      companyId = await upsertCompany(teamId, b.company, b.traits);
      if (companyId) {
        invalidateFlagCache(`${teamId}:`);
      }
    }

    let userId: string | null = null;
    if (b.user && companyId) {
      userId = await upsertUser(teamId, companyId, b.user, b.traits);
    }

    return NextResponse.json({ ok: true, data: { companyId, userId } });
  }

  // ── track ────────────────────────────────────────────────────
  const b = body as TrackEventBody;
  if (!b.name) {
    return NextResponse.json({ error: "name is required for track events" }, { status: 400 });
  }

  const companyId = b.company ? await upsertCompany(teamId, b.company) : null;
  const userId =
    b.user && companyId ? await upsertUser(teamId, companyId, b.user) : null;

  await db.schematicEvent.create({
    data: {
      teamId,
      eventType: "track",
      name: b.name,
      companyId,
      userId,
      traits: (b.traits ?? {}) as unknown as Prisma.InputJsonValue,
    },
  });

  // Invalidate usage cache so flag checks reflect the new event
  if (companyId) {
    invalidateUsageCache(teamId, companyId, b.name);
    invalidateFlagCache(`${teamId}:`);
  }

  return NextResponse.json({ ok: true, data: { companyId, userId } });
}
