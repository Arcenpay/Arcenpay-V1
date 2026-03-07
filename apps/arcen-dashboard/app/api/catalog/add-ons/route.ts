import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, isErrorResponse } from "@/lib/api-auth";
import { writeAuditEvent } from "@/lib/audit";

const createSchema = z.object({
  name: z.string().min(1),
  code: z
    .string()
    .min(1)
    .regex(/^[a-z0-9_\-]+$/i),
  description: z.string().optional(),
  billingType: z.enum(["ONE_TIME", "RECURRING"]).default("ONE_TIME"),
  price: z.coerce.number().positive(),
  acceptedToken: z.string().min(1),
  environmentMode: z.enum(["DEVELOPMENT", "PRODUCTION"]).default("DEVELOPMENT"),
});

const updateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  code: z
    .string()
    .min(1)
    .regex(/^[a-z0-9_\-]+$/i)
    .optional(),
  description: z.string().nullable().optional(),
  billingType: z.enum(["ONE_TIME", "RECURRING"]).optional(),
  price: z.coerce.number().positive().optional(),
  acceptedToken: z.string().min(1).optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(),
  active: z.boolean().optional(),
});

export async function GET(request: NextRequest) {
  const auth = await requirePermission("catalog:read");
  if (isErrorResponse(auth)) return auth;

  const environmentMode =
    request.nextUrl.searchParams.get("environmentMode") || undefined;
  const status = request.nextUrl.searchParams.get("status") || undefined;

  const addOns = await db.catalogAddOn.findMany({
    where: {
      teamId: auth.team.teamId,
      ...(environmentMode && {
        environmentMode: environmentMode as "DEVELOPMENT" | "PRODUCTION",
      }),
      ...(status && { status: status as "DRAFT" | "PUBLISHED" | "ARCHIVED" }),
    },
    orderBy: [{ updatedAt: "desc" }],
  });

  return NextResponse.json({ addOns });
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
  const addOn = await db.catalogAddOn.create({
    data: {
      teamId: auth.team.teamId,
      environmentMode: data.environmentMode,
      name: data.name,
      code: data.code,
      description: data.description,
      billingType: data.billingType,
      price: data.price.toFixed(6),
      acceptedToken: data.acceptedToken,
      status: "DRAFT",
      active: true,
      version: 1,
    },
  });

  await db.catalogVersion.create({
    data: {
      teamId: auth.team.teamId,
      environmentMode: addOn.environmentMode,
      entityType: "ADDON",
      entityId: addOn.id,
      version: 1,
      status: addOn.status,
      snapshot: addOn,
    },
  });

  await writeAuditEvent({
    request,
    teamId: auth.team.teamId,
    clerkUserId: auth.team.userId,
    walletAddress: auth.team.walletAddress,
    action: "catalog.addon.create",
    resourceType: "CatalogAddOn",
    resourceId: addOn.id,
    afterData: addOn,
  });

  return NextResponse.json({ addOn }, { status: 201 });
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

  const existing = await db.catalogAddOn.findFirst({
    where: { id: parsed.data.id, teamId: auth.team.teamId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Add-on not found" }, { status: 404 });
  }

  const updated = await db.catalogAddOn.update({
    where: { id: existing.id },
    data: {
      ...(parsed.data.name !== undefined && { name: parsed.data.name }),
      ...(parsed.data.code !== undefined && { code: parsed.data.code }),
      ...(parsed.data.description !== undefined && {
        description: parsed.data.description,
      }),
      ...(parsed.data.billingType !== undefined && {
        billingType: parsed.data.billingType,
      }),
      ...(parsed.data.price !== undefined && {
        price: parsed.data.price.toFixed(6),
      }),
      ...(parsed.data.acceptedToken !== undefined && {
        acceptedToken: parsed.data.acceptedToken,
      }),
      ...(parsed.data.status !== undefined && { status: parsed.data.status }),
      ...(parsed.data.active !== undefined && { active: parsed.data.active }),
      version: existing.version + 1,
      ...(parsed.data.status === "PUBLISHED" && { publishedAt: new Date() }),
    },
  });

  await db.catalogVersion.create({
    data: {
      teamId: auth.team.teamId,
      environmentMode: updated.environmentMode,
      entityType: "ADDON",
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
    clerkUserId: auth.team.userId,
    walletAddress: auth.team.walletAddress,
    action: "catalog.addon.update",
    resourceType: "CatalogAddOn",
    resourceId: updated.id,
    beforeData: existing,
    afterData: updated,
  });

  return NextResponse.json({ addOn: updated });
}
