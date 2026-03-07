import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  requirePermission,
  isErrorResponse,
} from "@/lib/api-auth";
import { writeAuditEvent } from "@/lib/audit";

const createSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1).regex(/^[a-z0-9_\-]+$/i),
  unitName: z.string().min(1),
  unitsPerPack: z.coerce.number().int().positive(),
  price: z.coerce.number().positive(),
  acceptedToken: z.string().min(1),
  environmentMode: z.enum(["DEVELOPMENT", "PRODUCTION"]).default("DEVELOPMENT"),
});

const updateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  code: z.string().min(1).regex(/^[a-z0-9_\-]+$/i).optional(),
  unitName: z.string().min(1).optional(),
  unitsPerPack: z.coerce.number().int().positive().optional(),
  price: z.coerce.number().positive().optional(),
  acceptedToken: z.string().min(1).optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(),
  active: z.boolean().optional(),
});

export async function GET(request: NextRequest) {
  const auth = await requirePermission("catalog:read");
  if (isErrorResponse(auth)) return auth;

  const environmentMode = request.nextUrl.searchParams.get("environmentMode") || undefined;
  const status = request.nextUrl.searchParams.get("status") || undefined;

  const creditTypes = await db.catalogCreditType.findMany({
    where: {
      teamId: auth.team.teamId,
      ...(environmentMode && {
        environmentMode: environmentMode as "DEVELOPMENT" | "PRODUCTION",
      }),
      ...(status && { status: status as "DRAFT" | "PUBLISHED" | "ARCHIVED" }),
    },
    orderBy: [{ updatedAt: "desc" }],
  });

  return NextResponse.json({ creditTypes });
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
  const creditType = await db.catalogCreditType.create({
    data: {
      teamId: auth.team.teamId,
      environmentMode: data.environmentMode,
      name: data.name,
      code: data.code,
      unitName: data.unitName,
      unitsPerPack: data.unitsPerPack,
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
      environmentMode: creditType.environmentMode,
      entityType: "CREDIT",
      entityId: creditType.id,
      version: 1,
      status: creditType.status,
      snapshot: creditType,
    },
  });

  await writeAuditEvent({
    request,
    teamId: auth.team.teamId,
    session: auth.session,
    action: "catalog.credit.create",
    resourceType: "CatalogCreditType",
    resourceId: creditType.id,
    afterData: creditType,
  });

  return NextResponse.json({ creditType }, { status: 201 });
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

  const existing = await db.catalogCreditType.findFirst({
    where: { id: parsed.data.id, teamId: auth.team.teamId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Credit type not found" }, { status: 404 });
  }

  const updated = await db.catalogCreditType.update({
    where: { id: existing.id },
    data: {
      ...(parsed.data.name !== undefined && { name: parsed.data.name }),
      ...(parsed.data.code !== undefined && { code: parsed.data.code }),
      ...(parsed.data.unitName !== undefined && { unitName: parsed.data.unitName }),
      ...(parsed.data.unitsPerPack !== undefined && {
        unitsPerPack: parsed.data.unitsPerPack,
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
      entityType: "CREDIT",
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
    session: auth.session,
    action: "catalog.credit.update",
    resourceType: "CatalogCreditType",
    resourceId: updated.id,
    beforeData: existing,
    afterData: updated,
  });

  return NextResponse.json({ creditType: updated });
}
