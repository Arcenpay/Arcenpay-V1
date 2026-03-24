import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, isErrorResponse } from "@/lib/api-auth";
import { writeAuditEvent } from "@/lib/audit";

// Credit grants are stored as JSON in CatalogPlan.metadata under the key "creditGrants"
// Shape: { creditTypeId: string, amount: number }[]

const creditGrantSchema = z.object({
  creditTypeId: z.string().min(1),
  amount: z.coerce.number().positive(),
});

function getCreditGrants(metadata: unknown): z.infer<typeof creditGrantSchema>[] {
  if (!metadata || typeof metadata !== "object") return [];
  const meta = metadata as Record<string, unknown>;
  if (!Array.isArray(meta.creditGrants)) return [];
  return meta.creditGrants as z.infer<typeof creditGrantSchema>[];
}

// GET /api/catalog/plans/[id]/credit-grants
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("catalog:read");
  if (isErrorResponse(auth)) return auth;

  const { id } = await params;

  const plan = await db.catalogPlan.findFirst({
    where: { id, teamId: auth.team.teamId },
  });
  if (!plan) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }

  const creditGrants = getCreditGrants(plan.metadata);
  return NextResponse.json({ creditGrants });
}

// POST /api/catalog/plans/[id]/credit-grants — add a new credit grant
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("catalog:write");
  if (isErrorResponse(auth)) return auth;

  const { id } = await params;

  const plan = await db.catalogPlan.findFirst({
    where: { id, teamId: auth.team.teamId },
  });
  if (!plan) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = creditGrantSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const existing = getCreditGrants(plan.metadata);
  // Check for duplicate creditTypeId
  if (existing.some((e) => e.creditTypeId === parsed.data.creditTypeId)) {
    return NextResponse.json(
      { error: "Credit type already granted on this plan" },
      { status: 409 },
    );
  }

  const newGrants = [...existing, parsed.data];
  const updatedMeta = {
    ...((plan.metadata as Record<string, unknown>) ?? {}),
    creditGrants: newGrants,
  };

  const updated = await db.catalogPlan.update({
    where: { id: plan.id },
    data: { metadata: updatedMeta },
  });

  await writeAuditEvent({
    request,
    teamId: auth.team.teamId,
    userId: auth.team.userId,
    walletAddress: auth.team.walletAddress,
    action: "catalog.plan.credit_grant.add",
    resourceType: "CatalogPlan",
    resourceId: plan.id,
    afterData: parsed.data,
  });

  return NextResponse.json(
    { creditGrants: newGrants, plan: updated },
    { status: 201 },
  );
}

// DELETE /api/catalog/plans/[id]/credit-grants?creditTypeId=xxx
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("catalog:write");
  if (isErrorResponse(auth)) return auth;

  const { id } = await params;
  const creditTypeId = request.nextUrl.searchParams.get("creditTypeId");

  if (!creditTypeId) {
    return NextResponse.json(
      { error: "creditTypeId is required" },
      { status: 400 },
    );
  }

  const plan = await db.catalogPlan.findFirst({
    where: { id, teamId: auth.team.teamId },
  });
  if (!plan) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }

  const existing = getCreditGrants(plan.metadata);
  const filtered = existing.filter((e) => e.creditTypeId !== creditTypeId);

  if (filtered.length === existing.length) {
    return NextResponse.json(
      { error: "Credit grant not found" },
      { status: 404 },
    );
  }

  const updatedMeta = {
    ...((plan.metadata as Record<string, unknown>) ?? {}),
    creditGrants: filtered,
  };

  await db.catalogPlan.update({
    where: { id: plan.id },
    data: { metadata: updatedMeta },
  });

  await writeAuditEvent({
    request,
    teamId: auth.team.teamId,
    userId: auth.team.userId,
    walletAddress: auth.team.walletAddress,
    action: "catalog.plan.credit_grant.remove",
    resourceType: "CatalogPlan",
    resourceId: plan.id,
    afterData: { creditTypeId },
  });

  return NextResponse.json({ creditGrants: filtered });
}
