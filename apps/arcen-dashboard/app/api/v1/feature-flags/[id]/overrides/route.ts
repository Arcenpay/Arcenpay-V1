import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission, isErrorResponse } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { invalidateFlagCache } from "@/lib/flag-cache";

const createSchema = z.object({
  companyId: z.string().min(1),
  value: z.boolean(),
  reason: z.string().trim().max(240).optional().nullable(),
});

async function requireFlagForTeam(id: string, teamId: string) {
  return db.catalogFeatureFlag.findFirst({
    where: { id, teamId },
    select: { id: true, featureKey: true },
  });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("catalog:read");
  if (isErrorResponse(auth)) return auth;

  const { id } = await params;
  const flag = await requireFlagForTeam(id, auth.team.teamId);
  if (!flag) {
    return NextResponse.json({ error: "Flag not found" }, { status: 404 });
  }

  const overrides = await db.companyOverride.findMany({
    where: {
      teamId: auth.team.teamId,
      featureKey: flag.featureKey,
    },
    include: {
      company: {
        select: {
          id: true,
          name: true,
          email: true,
          walletAddress: true,
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json({ data: overrides });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("catalog:write");
  if (isErrorResponse(auth)) return auth;

  const { id } = await params;
  const flag = await requireFlagForTeam(id, auth.team.teamId);
  if (!flag) {
    return NextResponse.json({ error: "Flag not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const company = await db.arcenCompany.findFirst({
    where: { id: parsed.data.companyId, teamId: auth.team.teamId },
    select: { id: true },
  });
  if (!company) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }

  const override = await db.companyOverride.upsert({
    where: {
      companyId_featureKey: {
        companyId: parsed.data.companyId,
        featureKey: flag.featureKey,
      },
    },
    update: {
      value: parsed.data.value,
      reason: parsed.data.reason || null,
    },
    create: {
      teamId: auth.team.teamId,
      companyId: parsed.data.companyId,
      featureKey: flag.featureKey,
      value: parsed.data.value,
      reason: parsed.data.reason || null,
    },
    include: {
      company: {
        select: {
          id: true,
          name: true,
          email: true,
          walletAddress: true,
        },
      },
    },
  });

  invalidateFlagCache(`${auth.team.teamId}:`);

  return NextResponse.json({ data: override }, { status: 201 });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("catalog:write");
  if (isErrorResponse(auth)) return auth;

  const { id } = await params;
  const flag = await requireFlagForTeam(id, auth.team.teamId);
  if (!flag) {
    return NextResponse.json({ error: "Flag not found" }, { status: 404 });
  }

  const companyId = req.nextUrl.searchParams.get("companyId");
  if (!companyId) {
    return NextResponse.json(
      { error: "companyId query param required" },
      { status: 400 },
    );
  }

  const existing = await db.companyOverride.findFirst({
    where: {
      teamId: auth.team.teamId,
      companyId,
      featureKey: flag.featureKey,
    },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Override not found" }, { status: 404 });
  }

  await db.companyOverride.delete({ where: { id: existing.id } });
  invalidateFlagCache(`${auth.team.teamId}:`);

  return NextResponse.json({ ok: true });
}
