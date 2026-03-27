/**
 * GET  /api/v1/users   — List users (paginated)
 * POST /api/v1/users   — Create or identify a user
 *
 * Authorization: Bearer api_xxx
 */

import { NextRequest, NextResponse } from "next/server";
import { requireApiKey, isApiKeyError } from "@/lib/api-key-auth";
import { db } from "@/lib/db";
import { Prisma } from "@/src/generated/prisma/client";

export async function GET(req: NextRequest) {
  const ctx = await requireApiKey(req);
  if (isApiKeyError(ctx)) return ctx;

  const { teamId } = ctx;
  const url = req.nextUrl;
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
  const cursor = url.searchParams.get("cursor");
  if (cursor !== null && cursor.trim() === "") {
    return NextResponse.json(
      { error: "cursor must be a non-empty string" },
      { status: 400 },
    );
  }
  const companyId = url.searchParams.get("companyId");
  const search = url.searchParams.get("search");

  const users = await db.arcenUser.findMany({
    where: {
      teamId,
      ...(companyId ? { companyId } : {}),
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
      email: true,
      walletAddress: true,
      clerkUserId: true,
      externalId: true,
      companyId: true,
      createdAt: true,
      lastSeenAt: true,
    },
  });

  const hasMore = users.length > limit;
  const items = hasMore ? users.slice(0, limit) : users;

  return NextResponse.json({
    data: items,
    count: items.length,
    nextCursor: hasMore ? items[items.length - 1]?.id : undefined,
  });
}

export async function POST(req: NextRequest) {
  const ctx = await requireApiKey(req);
  if (isApiKeyError(ctx)) return ctx;

  const { teamId } = ctx;

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
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.companyId) {
    return NextResponse.json(
      { error: "companyId is required" },
      { status: 400 },
    );
  }

  // ── Field length and format validation ───────────────────────
  if (body.name !== undefined && body.name.length > 128) {
    return NextResponse.json({ error: "name too long" }, { status: 400 });
  }
  if (body.email !== undefined) {
    if (body.email.length > 254) {
      return NextResponse.json({ error: "email too long" }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
      return NextResponse.json(
        { error: "Invalid email format" },
        { status: 400 },
      );
    }
  }
  if (body.wallet !== undefined && !/^0x[0-9a-fA-F]{40}$/.test(body.wallet)) {
    return NextResponse.json(
      { error: "Invalid wallet address format" },
      { status: 400 },
    );
  }
  if (body.id !== undefined && body.id.length > 64) {
    return NextResponse.json({ error: "id too long" }, { status: 400 });
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

  // Verify company belongs to team
  const company = await db.arcenCompany.findFirst({
    where: { id: body.companyId, teamId },
    select: { id: true },
  });
  if (!company) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }

  const walletAddress = body.wallet?.toLowerCase();

  // Check for duplicates
  const where: Record<string, unknown>[] = [];
  if (body.id) where.push({ teamId, externalId: body.id });
  if (walletAddress) where.push({ teamId, walletAddress });
  if (body.clerk_user_id)
    where.push({ teamId, clerkUserId: body.clerk_user_id });

  if (where.length > 0) {
    const existing = await db.arcenUser.findFirst({ where: { OR: where } });
    if (existing) {
      return NextResponse.json(
        { error: "User already exists", userId: existing.id },
        { status: 409 },
      );
    }
  }

  const user = await db.arcenUser.create({
    data: {
      teamId,
      companyId: body.companyId,
      externalId: body.id,
      walletAddress,
      clerkUserId: body.clerk_user_id,
      name: body.name,
      email: body.email,
      traits: (body.traits ?? {}) as unknown as Prisma.InputJsonValue,
    },
  });

  return NextResponse.json({ data: user }, { status: 201 });
}
