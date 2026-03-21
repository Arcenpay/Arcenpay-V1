/**
 * GET    /api/v1/companies/:id   — Get company detail (entitlements, plan, overrides, users)
 * PATCH  /api/v1/companies/:id   — Update company traits / plan assignment
 * DELETE /api/v1/companies/:id   — Delete company
 *
 * Authorization: Bearer api_xxx
 */

import { NextRequest, NextResponse } from "next/server";
import { requireApiKey, isApiKeyError } from "@/lib/api-key-auth";
import { db } from "@/lib/db";
import { evaluateFlags } from "@/lib/flag-engine";
import type { Prisma } from "@/src/generated/prisma/client";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireApiKey(req);
  if (isApiKeyError(ctx)) return ctx;

  const { id } = await params;
  const { teamId } = ctx;

  const company = await db.schematicCompany.findFirst({
    where: { id, teamId },
    include: {
      users: {
        select: { id: true, name: true, email: true, walletAddress: true, lastSeenAt: true },
        orderBy: { lastSeenAt: "desc" },
        take: 20,
      },
      overrides: {
        select: { id: true, featureKey: true, value: true, reason: true, createdAt: true },
      },
    },
  });

  if (!company) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }

  // Get active plan details if assigned
  let activePlan = null;
  if (company.activePlanId) {
    activePlan = await db.catalogPlan.findUnique({
      where: { id: company.activePlanId },
      select: { id: true, name: true, tier: true, price: true, billingInterval: true },
    });
  }

  // Get all feature flags for this team and evaluate them for this company
  const flags = await db.catalogFeatureFlag.findMany({
    where: { teamId },
    select: { featureKey: true, name: true },
  });

  const companyKeys = {
    id: company.externalId ?? undefined,
    wallet: company.walletAddress ?? undefined,
    email: company.email ?? undefined,
  };

  const flagResults = flags.length > 0
    ? await evaluateFlags(teamId, flags.map((f) => f.featureKey), companyKeys)
    : [];

  const entitlements = flagResults.map((r) => ({
    featureKey: r.flag,
    value: r.value,
    reason: r.reason,
  }));

  return NextResponse.json({
    data: {
      id: company.id,
      name: company.name,
      walletAddress: company.walletAddress,
      email: company.email,
      externalId: company.externalId,
      logoUrl: company.logoUrl,
      traits: company.traits,
      activePlan,
      activeAddOnIds: company.activeAddOnIds,
      createdAt: company.createdAt,
      lastSeenAt: company.lastSeenAt,
      users: company.users,
      overrides: company.overrides,
      entitlements,
    },
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireApiKey(req);
  if (isApiKeyError(ctx)) return ctx;

  const { id } = await params;
  const { teamId } = ctx;

  let body: {
    name?: string;
    traits?: Record<string, unknown>;
    activePlanId?: string | null;
    activeAddOnIds?: string[];
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const company = await db.schematicCompany.findFirst({
    where: { id, teamId },
  });

  if (!company) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }

  const updated = await db.schematicCompany.update({
    where: { id },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.traits !== undefined
        ? { traits: { ...(company.traits as Record<string, unknown>), ...body.traits } as unknown as Prisma.InputJsonValue }
        : {}),
      ...(body.activePlanId !== undefined ? { activePlanId: body.activePlanId } : {}),
      ...(body.activeAddOnIds !== undefined ? { activeAddOnIds: body.activeAddOnIds } : {}),
    },
  });

  return NextResponse.json({ data: updated });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireApiKey(req);
  if (isApiKeyError(ctx)) return ctx;

  const { id } = await params;
  const { teamId } = ctx;

  const company = await db.schematicCompany.findFirst({ where: { id, teamId } });
  if (!company) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }

  await db.schematicCompany.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
