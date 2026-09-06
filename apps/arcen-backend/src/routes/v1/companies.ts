/**
 * GET  /api/v1/companies   — List companies (paginated)
 * POST /api/v1/companies   — Create a company
 *
 * Authorization: Bearer api_xxx
 */

import type { Context } from "hono";
import { requireAnyAuth, isAnyAuthError } from "../../lib/auth/require-any-auth.js";
import { db } from "../../db.js";
import { Prisma } from "../../generated/client/client.js";
import { getCompanyEnvironmentWhere } from "../../lib/environments/company-scope.js";
import { assertCanCreateSubscriber } from "../../lib/catalog/tier-guard.js";

export async function GET(c: Context) {
  const ctx = await requireAnyAuth(c);
  if (isAnyAuthError(ctx)) return c.json({ ok: false, error: ctx.error }, ctx.status as any);

  const { teamId } = ctx;
  const environmentFilter = ctx.activeEnvironmentId
    ? await getCompanyEnvironmentWhere(ctx.activeEnvironmentId)
    : null;
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const cursor = c.req.query("cursor");
  if (cursor !== null && cursor !== undefined && cursor.trim() === "") {
    return c.json({ error: "cursor must be a non-empty string" }, 400 as any);
  }
  const search = c.req.query("search");
  const searchFilter: Prisma.ArcenCompanyWhereInput | null = search
    ? {
        OR: [
          { name: { contains: search, mode: Prisma.QueryMode.insensitive } },
          { email: { contains: search, mode: Prisma.QueryMode.insensitive } },
          {
            walletAddress: {
              contains: search,
              mode: Prisma.QueryMode.insensitive,
            },
          },
        ],
      }
    : null;

  const companies = await db.arcenCompany.findMany({
    where: {
      teamId,
      AND: [
        ...(environmentFilter ? [environmentFilter] : []),
        ...(searchFilter ? [searchFilter] : []),
      ],
    },
    orderBy: { lastSeenAt: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      name: true,
      walletAddress: true,
      email: true,
      externalId: true,
      activePlanId: true,
      logoUrl: true,
      createdAt: true,
      lastSeenAt: true,
    },
  });

  const hasMore = companies.length > limit;
  const items = hasMore ? companies.slice(0, limit) : companies;

  return c.json({
    data: items,
    count: items.length,
    nextCursor: hasMore ? items[items.length - 1]?.id : undefined,
  });
}

export async function POST(c: Context) {
  const ctx = await requireAnyAuth(c);
  if (isAnyAuthError(ctx)) return c.json({ ok: false, error: ctx.error }, ctx.status as any);

  const { teamId } = ctx;
  const environmentId = ctx.activeEnvironmentId;
  if (!environmentId) {
    return c.json({ error: "No workspace environment selected" }, 409 as any);
  }

  let body: {
    name: string;
    wallet?: string;
    email?: string;
    id?: string; // externalId
    traits?: Record<string, unknown>;
    logoUrl?: string;
  };

  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400 as any);
  }

  if (!body.name) {
    return c.json({ error: "name is required" }, 400 as any);
  }

  // ── Field length and format validation ───────────────────────
  if (body.name.length > 128) {
    return c.json({ error: "name too long" }, 400 as any);
  }
  if (body.email !== undefined) {
    if (body.email.length > 254) {
      return c.json({ error: "email too long" }, 400 as any);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
      return c.json({ error: "Invalid email format" }, 400 as any);
    }
  }
  if (body.wallet !== undefined && (typeof body.wallet !== "string" || body.wallet.trim().length === 0 || body.wallet.length > 128)) {
    return c.json({ error: "Invalid wallet address format" }, 400 as any);
  }
  if (body.id !== undefined && body.id.length > 64) {
    return c.json({ error: "id too long" }, 400 as any);
  }
  if (
    body.traits !== undefined &&
    (typeof body.traits !== "object" ||
      body.traits === null ||
      Array.isArray(body.traits))
  ) {
    return c.json({ error: "traits must be a plain object" }, 400 as any);
  }

  const walletAddress = body.wallet?.toLowerCase();
  const email = body.email?.trim().toLowerCase();

  // Enforce subscriber count limit
  const subscriberCheck = await assertCanCreateSubscriber(teamId);
  if (!subscriberCheck.allowed) {
    return c.json({
      error: "LIMIT_REACHED",
      message: subscriberCheck.reason,
    }, 409 as any);
  }

  // Check for duplicates
  if (walletAddress) {
    const existing = await db.arcenCompany.findUnique({
      where: {
        teamId_environmentId_walletAddress: {
          teamId,
          environmentId,
          walletAddress,
        },
      },
    });
    if (existing) {
      return c.json({
          error: "Company with this wallet already exists",
          companyId: existing.id,
        }, 409 as any);
    }
  }

  const company = await db.arcenCompany.create({
    data: {
      teamId,
      environmentId,
      name: body.name,
      walletAddress,
      email,
      externalId: body.id,
      traits: (body.traits ?? {}) as unknown as Prisma.InputJsonValue,
      logoUrl: body.logoUrl,
    },
  });

  return c.json({ data: company }, 201 as any);
}
