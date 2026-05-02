/**
 * GET    /api/v1/companies/:id   — Get company detail (entitlements, plan, overrides, users)
 * PATCH  /api/v1/companies/:id   — Update company traits / plan assignment
 * DELETE /api/v1/companies/:id   — Delete company
 *
 * Authorization: Bearer api_xxx
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAnyAuth, isAnyAuthError } from "@/lib/require-any-auth";
import { db } from "@/lib/db";
import { resolveEntitlementResults } from "@/lib/entitlements";
import type { Prisma } from "@/src/generated/prisma/client";
import { getCompanyAddOnGrants } from "@/lib/addon-grants";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireAnyAuth(req);
  if (isAnyAuthError(ctx)) return ctx;

  const { id } = await params;
  const { teamId } = ctx;

  const company = await db.arcenCompany.findFirst({
    where: { id, teamId },
    include: {
      users: {
        select: {
          id: true,
          name: true,
          email: true,
          walletAddress: true,
          lastSeenAt: true,
        },
        orderBy: { lastSeenAt: "desc" },
        take: 20,
      },
      overrides: {
        select: {
          id: true,
          featureKey: true,
          value: true,
          reason: true,
          createdAt: true,
        },
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
      select: {
        id: true,
        name: true,
        tier: true,
        price: true,
        billingInterval: true,
      },
    });
  }

  const companyKeys = {
    id: company.externalId ?? undefined,
    wallet: company.walletAddress ?? undefined,
    email: company.email ?? undefined,
  };
  const entitlementResults = await resolveEntitlementResults({
    teamId,
    companyKeys,
  });
  const addOnGrants = await getCompanyAddOnGrants(teamId, company.id);
  const activeAddOnIds = [
    ...new Set(
      addOnGrants
        .filter(
          (grant) =>
            grant.status === "ACTIVE" &&
            (!grant.expiresAt || grant.expiresAt > new Date()),
        )
        .map((grant) => grant.catalogAddOnId),
    ),
  ];

  const entitlements = entitlementResults.entitlements.map((result) => ({
    featureKey: result.key,
    value: result.enabled,
    reason: result.reason,
    allocation: result.allocation,
    usage: result.usage,
    exceeded: result.exceeded,
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
      activeAddOnIds,
      addOnGrants: addOnGrants.map((grant) => ({
        id: grant.id,
        status: grant.status,
        source: grant.source,
        grantedAt: grant.grantedAt,
        expiresAt: grant.expiresAt,
        cancelAtPeriodEnd: grant.cancelAtPeriodEnd,
        cancelledAt: grant.cancelledAt,
        addOn: grant.catalogAddOn,
        payment: grant.payment,
        checkoutSession: grant.checkoutSession,
      })),
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
  const ctx = await requireAnyAuth(req);
  if (isAnyAuthError(ctx)) return ctx;

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

  // ── Field length and type validation ────────────────────────
  if (body.name !== undefined && body.name.length > 128) {
    return NextResponse.json({ error: "name too long" }, { status: 400 });
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

  const company = await db.arcenCompany.findFirst({
    where: { id, teamId },
  });

  if (!company) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }

  const updated = await db.arcenCompany.update({
    where: { id },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.traits !== undefined
        ? {
            traits: {
              ...(company.traits as Record<string, unknown>),
              ...body.traits,
            } as unknown as Prisma.InputJsonValue,
          }
        : {}),
      ...(body.activePlanId !== undefined
        ? { activePlanId: body.activePlanId }
        : {}),
      ...(body.activeAddOnIds !== undefined
        ? { activeAddOnIds: body.activeAddOnIds }
        : {}),
    },
  });

  return NextResponse.json({ data: updated });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireAnyAuth(req);
  if (isAnyAuthError(ctx)) return ctx;

  const { id } = await params;
  const { teamId } = ctx;

  const company = await db.arcenCompany.findFirst({ where: { id, teamId } });
  if (!company) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }

  await db.arcenCompany.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
