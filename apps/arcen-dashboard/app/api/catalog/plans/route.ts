import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, isErrorResponse } from "@/lib/api-auth";
import { writeAuditEvent } from "@/lib/audit";
import { toPrismaNullableJson } from "@/lib/prisma-json";
import { assertCanCreatePlan } from "@/lib/tier-guard";

const listSchema = z.object({
  environmentMode: z.enum(["DEVELOPMENT", "PRODUCTION"]).optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(),
});

const createSchema = z.object({
  name: z.string().min(1),
  tier: z.string().min(1),
  description: z.string().optional(),
  price: z.coerce.number().nonnegative(),
  billingInterval: z.coerce.number().int().positive(),
  acceptedToken: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
  environmentMode: z.enum(["DEVELOPMENT", "PRODUCTION"]).default("DEVELOPMENT"),
});

const updateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  tier: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  price: z.coerce.number().positive().optional(),
  billingInterval: z.coerce.number().int().positive().optional(),
  acceptedToken: z.string().min(1).optional(),
  metadata: z.record(z.unknown()).optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(),
  active: z.boolean().optional(),
});

const deleteSchema = z.object({
  id: z.string().min(1),
});

export async function GET(request: NextRequest) {
  const auth = await requirePermission("catalog:read");
  if (isErrorResponse(auth)) return auth;

  const parsed = listSchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const plans = await db.catalogPlan.findMany({
    where: {
      teamId: auth.team.teamId,
      ...(parsed.data.environmentMode && {
        environmentMode: parsed.data.environmentMode,
      }),
      ...(parsed.data.status && { status: parsed.data.status }),
    },
    orderBy: [{ updatedAt: "desc" }],
  });

  return NextResponse.json({ plans });
}

export async function POST(request: NextRequest) {
  const auth = await requirePermission("catalog:write");
  if (isErrorResponse(auth)) return auth;

  const body = await request.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const data = parsed.data;

  // ── Tier limit enforcement ──────────────────────────────────────────────────
  const tierCheck = await assertCanCreatePlan(auth.team.teamId);
  if (!tierCheck.allowed) {
    return NextResponse.json(
      {
        error: "Plan limit reached",
        reason: tierCheck.reason,
        limit: tierCheck.limit,
        current: tierCheck.current,
        upgradeRequired: tierCheck.upgradeRequired,
      },
      { status: 403 },
    );
  }

  // Free plans (price = 0) cannot be registered on the PlanFactory contract
  // (it requires price > 0). Mark them NOT_APPLICABLE so the UI knows not to
  // show the "Register on-chain" action.
  const isFree = data.price === 0;

  const plan = await db.catalogPlan.create({
    data: {
      teamId: auth.team.teamId,
      environmentMode: data.environmentMode,
      name: data.name,
      tier: data.tier,
      description: data.description,
      price: data.price.toFixed(6),
      billingInterval: data.billingInterval,
      acceptedToken: data.acceptedToken,
      metadata: toPrismaNullableJson(data.metadata),
      status: "DRAFT",
      active: true,
      version: 1,
      chainSyncStatus: isFree ? "NOT_APPLICABLE" : "PENDING",
    },
  });

  await db.catalogVersion.create({
    data: {
      teamId: auth.team.teamId,
      environmentMode: plan.environmentMode,
      entityType: "PLAN",
      entityId: plan.id,
      version: 1,
      status: plan.status,
      snapshot: plan,
    },
  });

  await writeAuditEvent({
    request,
    teamId: auth.team.teamId,
    userId: auth.team.userId,
    walletAddress: auth.team.walletAddress,
    action: "catalog.plan.create",
    resourceType: "CatalogPlan",
    resourceId: plan.id,
    afterData: plan,
  });

  return NextResponse.json({ plan }, { status: 201 });
}

export async function PUT(request: NextRequest) {
  const auth = await requirePermission("catalog:write");
  if (isErrorResponse(auth)) return auth;

  const body = await request.json().catch(() => ({}));
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const existing = await db.catalogPlan.findFirst({
    where: { id: parsed.data.id, teamId: auth.team.teamId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }

  const nextVersion = existing.version + 1;

  // If price changes, update chainSyncStatus accordingly (only when not yet on-chain)
  const newPrice = parsed.data.price ?? parseFloat(existing.price.toString());
  const chainSyncUpdate =
    !existing.onChainPlanId && parsed.data.price !== undefined
      ? { chainSyncStatus: newPrice === 0 ? ("NOT_APPLICABLE" as const) : ("PENDING" as const) }
      : {};

  const updated = await db.catalogPlan.update({
    where: { id: existing.id },
    data: {
      ...(parsed.data.name !== undefined && { name: parsed.data.name }),
      ...(parsed.data.tier !== undefined && { tier: parsed.data.tier }),
      ...(parsed.data.description !== undefined && {
        description: parsed.data.description,
      }),
      ...(parsed.data.price !== undefined && {
        price: parsed.data.price.toFixed(6),
      }),
      ...(parsed.data.billingInterval !== undefined && {
        billingInterval: parsed.data.billingInterval,
      }),
      ...(parsed.data.acceptedToken !== undefined && {
        acceptedToken: parsed.data.acceptedToken,
      }),
      ...(parsed.data.metadata !== undefined && {
        metadata: toPrismaNullableJson(parsed.data.metadata),
      }),
      ...(parsed.data.status !== undefined && { status: parsed.data.status }),
      ...(parsed.data.active !== undefined && { active: parsed.data.active }),
      version: nextVersion,
      ...(parsed.data.status === "PUBLISHED" && { publishedAt: new Date() }),
      ...chainSyncUpdate,
    },
  });

  await db.catalogVersion.create({
    data: {
      teamId: auth.team.teamId,
      environmentMode: updated.environmentMode,
      entityType: "PLAN",
      entityId: updated.id,
      version: updated.version,
      status: updated.status,
      snapshot: updated,
      ...(updated.status === "PUBLISHED" && { publishedAt: new Date() }),
    },
  });

  await writeAuditEvent({
    request,
    teamId: auth.team.teamId,
    userId: auth.team.userId,
    walletAddress: auth.team.walletAddress,
    action: "catalog.plan.update",
    resourceType: "CatalogPlan",
    resourceId: updated.id,
    beforeData: existing,
    afterData: updated,
  });

  return NextResponse.json({ plan: updated });
}

export async function DELETE(request: NextRequest) {
  const auth = await requirePermission("catalog:write");
  if (isErrorResponse(auth)) return auth;

  const body = await request.json().catch(() => ({}));
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const existing = await db.catalogPlan.findFirst({
    where: { id: parsed.data.id, teamId: auth.team.teamId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }

  if (existing.status === "PUBLISHED") {
    return NextResponse.json(
      { error: "Published plans cannot be deleted. Archive the plan instead." },
      { status: 409 },
    );
  }

  if (existing.onChainPlanId) {
    return NextResponse.json(
      {
        error:
          "On-chain plans cannot be deleted from catalog. Archive or deactivate them instead.",
      },
      { status: 409 },
    );
  }

  await db.$transaction([
    db.catalogVersion.deleteMany({
      where: {
        teamId: auth.team.teamId,
        entityType: "PLAN",
        entityId: existing.id,
      },
    }),
    db.catalogPlan.delete({ where: { id: existing.id } }),
  ]);

  await writeAuditEvent({
    request,
    teamId: auth.team.teamId,
    userId: auth.team.userId,
    walletAddress: auth.team.walletAddress,
    action: "catalog.plan.delete",
    resourceType: "CatalogPlan",
    resourceId: existing.id,
    beforeData: existing,
  });

  return NextResponse.json({ success: true });
}
