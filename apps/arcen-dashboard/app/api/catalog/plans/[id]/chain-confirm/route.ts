import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, isErrorResponse } from "@/lib/api-auth";
import { writeAuditEvent } from "@/lib/audit";

const confirmSchema = z.object({
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "Invalid tx hash"),
  onChainPlanId: z.string().optional(),
  success: z.boolean(),
  errorMessage: z.string().optional(),
});

type Params = { id: string };

export async function POST(
  request: NextRequest,
  context: { params: Promise<Params> },
) {
  const auth = await requirePermission("catalog:write");
  if (isErrorResponse(auth)) return auth;

  const body = await request.json().catch(() => ({}));
  const parsed = confirmSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { id: planId } = await context.params;
  const { txHash, onChainPlanId, success, errorMessage } = parsed.data;

  const plan = await db.catalogPlan.findFirst({
    where: { id: planId, teamId: auth.team.teamId },
    select: { id: true, name: true, status: true, chainSyncStatus: true },
  });

  if (!plan) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }

  if (plan.status !== "PUBLISHED") {
    return NextResponse.json(
      { error: "Chain confirmation can only be recorded for PUBLISHED plans" },
      { status: 409 },
    );
  }

  const updatedPlan = await db.catalogPlan.update({
    where: { id: planId },
    data: {
      chainSyncStatus: success ? "SYNCED" : "FAILED",
      chainTxHash: txHash,
      chainSyncError: success ? null : (errorMessage ?? "Unknown error"),
      chainSyncedAt: success ? new Date() : null,
      ...(success && onChainPlanId ? { onChainPlanId } : {}),
    },
    select: {
      id: true,
      name: true,
      chainSyncStatus: true,
      chainTxHash: true,
      onChainPlanId: true,
      chainSyncedAt: true,
    },
  });

  await writeAuditEvent({
    request,
    teamId: auth.team.teamId,
    userId: auth.team.userId,
    walletAddress: auth.team.walletAddress,
    action: success ? "catalog.plan.chain_synced" : "catalog.plan.chain_sync_failed",
    resourceType: "CatalogPlan",
    resourceId: planId,
    metadata: { txHash, onChainPlanId, success, errorMessage },
  });

  return NextResponse.json({ ok: true, plan: updatedPlan });
}
