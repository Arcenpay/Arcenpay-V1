/**
 * GET  /api/v1/companies   — List companies (paginated)
 * POST /api/v1/companies   — Create a company
 *
 * Authorization: Bearer api_xxx
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAnyAuth, isAnyAuthError } from "@/lib/require-any-auth";
import { db } from "@/lib/db";
import { Prisma } from "@/src/generated/prisma/client";

export async function GET(req: NextRequest) {
  const ctx = await requireAnyAuth(req);
  if (isAnyAuthError(ctx)) return ctx;

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

  return NextResponse.json({
    data: items,
    count: items.length,
    nextCursor: hasMore ? items[items.length - 1]?.id : undefined,
  });
}

export async function POST(req: NextRequest) {
  const ctx = await requireAnyAuth(req);
  if (isAnyAuthError(ctx)) return ctx;

  const { teamId } = ctx;

  let body: {
    name: string;
    wallet?: string;
    email?: string;
    id?: string; // externalId
    traits?: Record<string, unknown>;
    logoUrl?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  // ── Field length and format validation ───────────────────────
  if (body.name.length > 128) {
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

  const walletAddress = body.wallet?.toLowerCase();

  // Check for duplicates
  if (walletAddress) {
    const existing = await db.arcenCompany.findUnique({
      where: { teamId_walletAddress: { teamId, walletAddress } },
    });
    if (existing) {
      return NextResponse.json(
        {
          error: "Company with this wallet already exists",
          companyId: existing.id,
        },
        { status: 409 },
      );
    }
  }

  const company = await db.arcenCompany.create({
    data: {
      teamId,
      name: body.name,
      walletAddress,
      email: body.email,
      externalId: body.id,
      traits: (body.traits ?? {}) as unknown as Prisma.InputJsonValue,
      logoUrl: body.logoUrl,
    },
  });

  return NextResponse.json({ data: company }, { status: 201 });
}
