import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, isErrorResponse } from "@/lib/api-auth";
import { writeAuditEvent } from "@/lib/audit";

// Plan grants are stored as JSON in CatalogCreditType.metadata under the key "planGrants"
// Shape: { planId: string, amount: number }[]

const planGrantSchema = z.object({
  planId: z.string().min(1),
  amount: z.coerce.number().positive(),
});

function getPlanGrants(metadata: unknown): z.infer<typeof planGrantSchema>[] {
  if (!metadata || typeof metadata !== "object") return [];
  const meta = metadata as Record<string, unknown>;
  if (!Array.isArray(meta.planGrants)) return [];
  return meta.planGrants as z.infer<typeof planGrantSchema>[];
}

// GET /api/catalog/credits/[id]/plan-grants
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("catalog:read");
  if (isErrorResponse(auth)) return auth;

  const { id } = await params;

  const creditType = await db.catalogCreditType.findFirst({
    where: { id, teamId: auth.team.teamId },
  });
  if (!creditType) {
    return NextResponse.json({ error: "Credit type not found" }, { status: 404 });
  }

  const planGrants = getPlanGrants(creditType.metadata);
  return NextResponse.json({ planGrants });
}

// POST /api/catalog/credits/[id]/plan-grants — add or update a plan grant
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("catalog:write");
  if (isErrorResponse(auth)) return auth;

  const { id } = await params;

  const creditType = await db.catalogCreditType.findFirst({
    where: { id, teamId: auth.team.teamId },
  });
  if (!creditType) {
    return NextResponse.json({ error: "Credit type not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = planGrantSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const existing = getPlanGrants(creditType.metadata);
  const planId = parsed.data.planId;

  let newGrants;
  if (existing.some((g) => g.planId === planId)) {
    // Update existing
    newGrants = existing.map((g) => (g.planId === planId ? parsed.data : g));
  } else {
    // Add new
    newGrants = [...existing, parsed.data];
  }

  const updatedMeta = {
    ...((creditType.metadata as Record<string, unknown>) ?? {}),
    planGrants: newGrants,
  };

  const updated = await db.catalogCreditType.update({
    where: { id: creditType.id },
    data: { metadata: updatedMeta },
  });

  await writeAuditEvent({
    request,
    teamId: auth.team.teamId,
    userId: auth.team.userId,
    walletAddress: auth.team.walletAddress,
    action: "catalog.credit.plan_grant.save",
    resourceType: "CatalogCreditType",
    resourceId: creditType.id,
    afterData: parsed.data,
  });

  return NextResponse.json({ planGrants: newGrants, creditType: updated });
}

// DELETE /api/catalog/credits/[id]/plan-grants?planId=xxx
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("catalog:write");
  if (isErrorResponse(auth)) return auth;

  const { id } = await params;
  const planId = request.nextUrl.searchParams.get("planId");

  if (!planId) {
    return NextResponse.json(
      { error: "planId is required" },
      { status: 400 },
    );
  }

  const creditType = await db.catalogCreditType.findFirst({
    where: { id, teamId: auth.team.teamId },
  });
  if (!creditType) {
    return NextResponse.json({ error: "Credit type not found" }, { status: 404 });
  }

  const existing = getPlanGrants(creditType.metadata);
  const filtered = existing.filter((g) => g.planId !== planId);

  if (filtered.length === existing.length) {
    return NextResponse.json({ error: "Plan grant not found" }, { status: 404 });
  }

  const updatedMeta = {
    ...((creditType.metadata as Record<string, unknown>) ?? {}),
    planGrants: filtered,
  };

  await db.catalogCreditType.update({
    where: { id: creditType.id },
    data: { metadata: updatedMeta },
  });

  await writeAuditEvent({
    request,
    teamId: auth.team.teamId,
    userId: auth.team.userId,
    walletAddress: auth.team.walletAddress,
    action: "catalog.credit.plan_grant.remove",
    resourceType: "CatalogCreditType",
    resourceId: creditType.id,
    afterData: { planId },
  });

  return NextResponse.json({ planGrants: filtered });
}
