import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, isErrorResponse } from "@/lib/api-auth";
import { writeAuditEvent } from "@/lib/audit";

const publishSchema = z.object({
  environmentMode: z.enum(["DEVELOPMENT", "PRODUCTION"]),
});

export async function POST(request: NextRequest) {
  const auth = await requirePermission("catalog:write");
  if (isErrorResponse(auth)) return auth;

  const body = await request.json().catch(() => ({}));
  const parsed = publishSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const environmentMode = parsed.data.environmentMode;

  // Fetch each draft entity's details for per-entity outcome reporting
  const [plans, addOns, credits] = await Promise.all([
    db.catalogPlan.findMany({
      where: { teamId: auth.team.teamId, environmentMode, status: "DRAFT" },
      select: { id: true, name: true, tier: true, onChainPlanId: true, chainSyncError: true, chainSyncStatus: true },
    }),
    db.catalogAddOn.findMany({
      where: { teamId: auth.team.teamId, environmentMode, status: "DRAFT" },
      select: { id: true, name: true, code: true },
    }),
    db.catalogCreditType.findMany({
      where: { teamId: auth.team.teamId, environmentMode, status: "DRAFT" },
      select: { id: true, name: true, code: true },
    }),
  ]);

  const now = new Date();

  // Plans need on-chain PlanFactory registration — mark them PENDING.
  // Add-ons and credits are off-chain catalog items — mark NOT_APPLICABLE.
  await db.$transaction([
    ...plans.map((p) =>
      db.catalogPlan.update({
        where: { id: p.id },
        data: {
          status: "PUBLISHED",
          publishedAt: now,
          // Plans with no onChainPlanId need on-chain registration via PlanFactory
          chainSyncStatus: p.onChainPlanId ? "SYNCED" : "PENDING",
        },
      }),
    ),
    db.catalogAddOn.updateMany({
      where: { teamId: auth.team.teamId, environmentMode, status: "DRAFT" },
      data: { status: "PUBLISHED", publishedAt: now, chainSyncStatus: "NOT_APPLICABLE" },
    }),
    db.catalogCreditType.updateMany({
      where: { teamId: auth.team.teamId, environmentMode, status: "DRAFT" },
      data: { status: "PUBLISHED", publishedAt: now, chainSyncStatus: "NOT_APPLICABLE" },
    }),
  ]);

  await writeAuditEvent({
    request,
    teamId: auth.team.teamId,
    userId: auth.team.userId,
    walletAddress: auth.team.walletAddress,
    action: "catalog.publish",
    resourceType: "Catalog",
    metadata: {
      environmentMode,
      plans: plans.length,
      addOns: addOns.length,
      credits: credits.length,
    },
  });

  const pendingChainSync = plans.filter((p) => !p.onChainPlanId);

  return NextResponse.json({
    ok: true,
    environmentMode,
    published: {
      plans: plans.map((p) => ({
        id: p.id,
        name: p.name,
        tier: p.tier,
        chainSyncStatus: p.onChainPlanId ? "SYNCED" : "PENDING",
        onChainPlanId: p.onChainPlanId ?? null,
        chainSyncError: p.chainSyncError ?? null,
        retryHint: !p.onChainPlanId
          ? "Call PlanFactory.createPlan() then POST /api/catalog/chain-sync with the resulting txHash and onChainPlanId."
          : null,
      })),
      addOns: addOns.map((a) => ({
        id: a.id,
        name: a.name,
        code: a.code,
        chainSyncStatus: "NOT_APPLICABLE",
      })),
      credits: credits.map((c) => ({
        id: c.id,
        name: c.name,
        code: c.code,
        chainSyncStatus: "NOT_APPLICABLE",
      })),
    },
    chainSync: {
      required: pendingChainSync.length > 0,
      pendingCount: pendingChainSync.length,
      pendingPlanIds: pendingChainSync.map((p) => p.id),
      message:
        pendingChainSync.length > 0
          ? `${pendingChainSync.length} plan(s) need on-chain registration via PlanFactory. Call recordChainSync after the transaction confirms.`
          : "All entities are synced or do not require chain registration.",
    },
  });
}
