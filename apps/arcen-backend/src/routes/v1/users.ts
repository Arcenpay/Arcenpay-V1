/**
 * GET  /api/v1/users   — List users (paginated)
 * POST /api/v1/users   — Create or identify a user
 *
 * Authorization: Bearer sk_/pk_/rk_
 */

import type { Context } from "hono";
import { requireAnyAuth, isAnyAuthError } from "../../lib/auth/require-any-auth.js";
import { db } from "../../db.js";
import { Prisma } from "../../generated/client/client.js";
import { normalizeWallet } from "../../lib/billing/utils.js";

export async function GET(c: Context) {
  const ctx = await requireAnyAuth(c);
  if (isAnyAuthError(ctx)) return c.json({ ok: false, error: ctx.error }, ctx.status as any);

  const { teamId } = ctx;
  const environmentId = ctx.activeEnvironmentId;
  if (!environmentId) {
    return c.json({ error: "No workspace environment selected" }, 409 as any);
  }
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const cursor = c.req.query("cursor");
  if (cursor !== null && cursor !== undefined && cursor.trim() === "") {
    return c.json({ error: "cursor must be a non-empty string" }, 400 as any);
  }
  const companyId = c.req.query("companyId");
  const search = c.req.query("search");

  const users = await db.arcenUser.findMany({
    where: {
      teamId,
      environmentId,
      ...(companyId ? { companyId } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { email: { contains: search, mode: "insensitive" } },
              { walletAddress: { contains: search, mode: "insensitive" } },
              { company: { name: { contains: search, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    orderBy: { lastSeenAt: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      name: true,
      email: true,
      walletAddress: true,
      clerkUserId: true,
      externalId: true,
      companyId: true,
      createdAt: true,
      lastSeenAt: true,
      company: {
        select: {
          id: true,
          name: true,
          email: true,
          walletAddress: true,
        },
      },
    },
  });

  const hasMore = users.length > limit;
  const items = hasMore ? users.slice(0, limit) : users;

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
    companyId: string;
    id?: string; // externalId
    wallet?: string;
    clerk_user_id?: string;
    name?: string;
    email?: string;
    traits?: Record<string, unknown>;
  };

  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400 as any);
  }

  if (!body.companyId) {
    return c.json({ error: "companyId is required" }, 400 as any);
  }

  // ── Field length and format validation ───────────────────────
  if (body.name !== undefined && body.name.length > 128) {
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

  // Verify company belongs to team
  const company = await db.arcenCompany.findFirst({
    where: { id: body.companyId, teamId, environmentId },
    select: { id: true },
  });
  if (!company) {
    return c.json({ error: "Company not found" }, 404 as any);
  }

  const walletAddress = normalizeWallet(body.wallet) ?? undefined;
  const email = body.email?.trim().toLowerCase();

  // Check for duplicates
  const where: Record<string, unknown>[] = [];
  if (body.id) where.push({ teamId, externalId: body.id });
  if (walletAddress) where.push({ teamId, walletAddress });
  if (body.clerk_user_id)
    where.push({ teamId, clerkUserId: body.clerk_user_id });
  if (email) {
    where.push({ teamId, email: { equals: email, mode: "insensitive" } });
  }

  if (where.length > 0) {
    const existing = await db.arcenUser.findFirst({
      where: {
        teamId,
        environmentId,
        OR: where.map((entry) => {
          const { teamId: _teamId, ...rest } = entry as Record<string, unknown>;
          return rest;
        }),
      },
    });
    if (existing) {
      return c.json({ error: "User already exists", userId: existing.id }, 409 as any);
    }
  }

  const user = await db.arcenUser.create({
    data: {
      teamId,
      environmentId,
      companyId: body.companyId,
      externalId: body.id,
      walletAddress,
      clerkUserId: body.clerk_user_id,
      name: body.name,
      email,
      traits: (body.traits ?? {}) as unknown as Prisma.InputJsonValue,
    },
  });

  return c.json({ data: user }, 201 as any);
}
