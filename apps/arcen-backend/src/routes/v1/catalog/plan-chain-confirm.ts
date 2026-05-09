import type { Context } from "hono";
import { z } from "zod";
import { db } from "../../../db.js";
import { requirePermission, isErrorResponse } from "../../../lib/auth/api-auth.js";
import { writeAuditEvent } from "../../../lib/platform/audit.js";

const confirmSchema = z.object({
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "Invalid tx hash"),
  onChainPlanId: z.string().optional(),
  success: z.boolean(),
  errorMessage: z.string().optional(),
});

export async function confirmPlanOnChain(c: Context) {
  const auth = await requirePermission(c, "catalog:write");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const body = await c.req.json() .catch(() => ({}));
  const parsed = confirmSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors }, 400 as any);
  }

  const planId = c.req.param("id");
  const { txHash, onChainPlanId, success, errorMessage } = parsed.data;

  const plan = await db.catalogPlan.findFirst({
    where: { id: planId, teamId: auth.team.teamId },
    select: { id: true, name: true, status: true, chainSyncStatus: true },
  });

  if (!plan) {
    return c.json({ error: "Plan not found" }, 404 as any);
  }

  if (plan.status !== "PUBLISHED") {
    return c.json({ error: "Chain confirmation can only be recorded for PUBLISHED plans" }, 409 as any);
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
    headers: c.req.raw.headers,
    teamId: auth.team.teamId,
    userId: auth.team.userId,
    walletAddress: auth.team.walletAddress,
    action: success ? "catalog.plan.chain_synced" : "catalog.plan.chain_sync_failed",
    resourceType: "CatalogPlan",
    resourceId: planId,
    metadata: { txHash, onChainPlanId, success, errorMessage },
  });

  return c.json({ ok: true, plan: updatedPlan });
}
