import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, isErrorResponse } from "@/lib/api-auth";
import { writeAuditEvent } from "@/lib/audit";
import { toPrismaNullableJson } from "@/lib/prisma-json";

const listSchema = z.object({
  environmentMode: z.enum(["DEVELOPMENT", "PRODUCTION"]).optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(),
});

const createSchema = z.object({
  name: z.string().min(1),
  tier: z.string().min(1),
  description: z.string().optional(),
  price: z.coerce.number().positive(),
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
