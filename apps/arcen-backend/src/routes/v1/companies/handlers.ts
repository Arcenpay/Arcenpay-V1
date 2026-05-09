import type { Context } from "hono";
import { db } from "../../../db.js";
import { apiError } from "../../../utils/api-response.js";
import { Prisma } from "../../../generated/client/client.js";
import { requireAnyAuth, isAnyAuthError } from "../../../lib/auth/require-any-auth.js";

export async function listCompanies(c: Context) {
  const auth = await requireAnyAuth(c);
  if (isAnyAuthError(auth)) {
    return c.json({ ok: false, error: auth.error }, auth.status as any);
  }

  const { teamId } = auth;
  const url = new URL(c.req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
  const cursor = url.searchParams.get("cursor");
  const search = url.searchParams.get("search");

  const companies = await db.arcenCompany.findMany({
    where: {
      teamId,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { email: { contains: search, mode: "insensitive" } },
              { walletAddress: { contains: search, mode: "insensitive" } },
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

export async function createCompany(c: Context) {
  const auth = await requireAnyAuth(c);
  if (isAnyAuthError(auth)) {
    return c.json({ ok: false, error: auth.error }, auth.status as any);
  }

  const { teamId } = auth;

  let body: {
    name: string;
    wallet?: string;
    email?: string;
    id?: string;
    traits?: Record<string, unknown>;
    logoUrl?: string;
  };

  try {
    body = await c.req.json();
  } catch {
    return apiError(c, "Invalid JSON body", { status: 400, code: "INVALID_INPUT" });
  }

  if (!body.name) {
    return apiError(c, "name is required", { status: 400, code: "INVALID_INPUT" });
  }

  if (body.name.length > 128) {
    return apiError(c, "name too long", { status: 400, code: "INVALID_INPUT" });
  }

  if (body.email !== undefined) {
    if (body.email.length > 254) {
      return apiError(c, "email too long", { status: 400, code: "INVALID_INPUT" });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
      return apiError(c, "Invalid email format", { status: 400, code: "INVALID_INPUT" });
    }
  }

  if (body.wallet !== undefined && !/^0x[0-9a-fA-F]{40}$/.test(body.wallet)) {
    return apiError(c, "Invalid wallet address format", { status: 400, code: "INVALID_INPUT" });
  }

  if (body.id !== undefined && body.id.length > 64) {
    return apiError(c, "id too long", { status: 400, code: "INVALID_INPUT" });
  }

  const walletAddress = body.wallet?.toLowerCase();
  const email = body.email?.trim().toLowerCase();

  if (walletAddress) {
    const existing = await db.arcenCompany.findUnique({
      where: { teamId_walletAddress: { teamId, walletAddress } },
    });
    if (existing) {
      return apiError(c, "Company with this wallet already exists", {
        status: 409,
        code: "CONFLICT",
      });
    }
  }

  const company = await db.arcenCompany.create({
    data: {
      teamId,
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
