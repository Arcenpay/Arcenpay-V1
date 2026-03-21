/**
 * GET  /api/v1/companies   — List companies (paginated)
 * POST /api/v1/companies   — Create a company
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
  const search = url.searchParams.get("search");

  const companies = await db.schematicCompany.findMany({
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
  const ctx = await requireApiKey(req);
  if (isApiKeyError(ctx)) return ctx;

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

  const walletAddress = body.wallet?.toLowerCase();

  // Check for duplicates
  if (walletAddress) {
    const existing = await db.schematicCompany.findUnique({
      where: { teamId_walletAddress: { teamId, walletAddress } },
    });
    if (existing) {
      return NextResponse.json(
        { error: "Company with this wallet already exists", companyId: existing.id },
        { status: 409 },
      );
    }
  }

  const company = await db.schematicCompany.create({
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
