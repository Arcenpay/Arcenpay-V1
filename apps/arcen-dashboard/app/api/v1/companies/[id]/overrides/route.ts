/**
 * GET    /api/v1/companies/:id/overrides   — List company overrides
 * POST   /api/v1/companies/:id/overrides   — Set/update an override
 * DELETE /api/v1/companies/:id/overrides   — Remove an override (by featureKey query param)
 *
 * Authorization: Bearer api_xxx
 */

import { NextRequest, NextResponse } from "next/server";
import { requireApiKey, isApiKeyError } from "@/lib/api-key-auth";
import { db } from "@/lib/db";
import { invalidateFlagCache } from "@/lib/flag-cache";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireApiKey(req);
  if (isApiKeyError(ctx)) return ctx;

  const { id } = await params;
  const { teamId } = ctx;

  const company = await db.arcenCompany.findFirst({
    where: { id, teamId },
    select: { id: true },
  });
  if (!company)
    return NextResponse.json({ error: "Company not found" }, { status: 404 });

  const overrides = await db.companyOverride.findMany({
    where: { companyId: id, teamId },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ data: overrides });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireApiKey(req);
  if (isApiKeyError(ctx)) return ctx;

  const { id } = await params;
  const { teamId } = ctx;

  let body: { featureKey: string; value: boolean; reason?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.featureKey !== "string" || typeof body.value !== "boolean") {
    return NextResponse.json(
      { error: "featureKey (string) and value (boolean) are required" },
      { status: 400 },
    );
  }

  const company = await db.arcenCompany.findFirst({
    where: { id, teamId },
    select: { id: true },
  });
  if (!company)
    return NextResponse.json({ error: "Company not found" }, { status: 404 });

  const override = await db.companyOverride.upsert({
    where: {
      companyId_featureKey: { companyId: id, featureKey: body.featureKey },
    },
    create: {
      teamId,
      companyId: id,
      featureKey: body.featureKey,
      value: body.value,
      reason: body.reason,
    },
    update: {
      value: body.value,
      reason: body.reason,
    },
  });

  invalidateFlagCache(`${teamId}:`);

  return NextResponse.json({ data: override });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireApiKey(req);
  if (isApiKeyError(ctx)) return ctx;

  const { id } = await params;
  const { teamId } = ctx;
  const featureKey = req.nextUrl.searchParams.get("featureKey");

  if (!featureKey) {
    return NextResponse.json(
      { error: "featureKey query param required" },
      { status: 400 },
    );
  }

  const company = await db.arcenCompany.findFirst({
    where: { id, teamId },
    select: { id: true },
  });
  if (!company)
    return NextResponse.json({ error: "Company not found" }, { status: 404 });

  await db.companyOverride.deleteMany({
    where: { companyId: id, featureKey },
  });

  invalidateFlagCache(`${teamId}:`);

  return NextResponse.json({ ok: true });
}
