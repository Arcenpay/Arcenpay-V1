import type { Context } from "hono";
import { z } from "zod";
import { db } from "../../../db.js";
import { requirePermission, isErrorResponse } from "../../../lib/auth/api-auth.js";
import { writeAuditEvent } from "../../../lib/platform/audit.js";

const publishSchema = z.object({
  environmentMode: z.enum(["DEVELOPMENT", "PRODUCTION"]),
});

export async function publishCatalog(c: Context) {
  const auth = await requirePermission(c, "catalog:write");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const body = await c.req.json() .catch(() => ({}));
  const parsed = publishSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors }, 400 as any);
  }

  const environmentMode = parsed.data.environmentMode;

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

  await db.$transaction([
    ...plans.map((p) =>
      db.catalogPlan.update({
        where: { id: p.id },
        data: {
          status: "PUBLISHED",
          publishedAt: now,
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
    headers: c.req.raw.headers,
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

  return c.json({
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
