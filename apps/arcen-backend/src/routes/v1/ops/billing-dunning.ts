import type { Context } from "hono";
import { z } from "zod";
import { db } from "../../../db.js";
import { writeAuditEvent } from "../../../lib/platform/audit.js";
import { runBillingDunningSweep } from "../../../lib/billing/billing-dunning.js";
import { requireTeamRoles, isErrorResponse } from "../../../lib/auth/api-auth.js";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export async function getDunningPreview(c: Context) {
  const auth = await requireTeamRoles(c, ["OWNER", "ADMIN"]);
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const parsed = querySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: "Invalid query", details: parsed.error.flatten().fieldErrors }, 400 as any);
  }

  const candidates = await db.subscriptionState.findMany({
    where: {
      teamId: auth.team.teamId,
      status: "PAST_DUE",
      graceEndsAt: { lte: new Date() },
    },
    orderBy: { graceEndsAt: "asc" },
    take: parsed.data.limit,
    select: {
      id: true,
      companyId: true,
      walletAddress: true,
      catalogPlanId: true,
      pastDueAt: true,
      graceEndsAt: true,
      lastSourceTxHash: true,
    },
  });

  return c.json({
    count: candidates.length,
    candidates,
  });
}

export async function runDunningSweep(c: Context) {
  const auth = await requireTeamRoles(c, ["OWNER", "ADMIN"]);
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const sweep = await runBillingDunningSweep({
    teamId: auth.team.teamId,
    limit: 100,
  });

  await writeAuditEvent({
    headers: c.req.raw.headers,
    teamId: auth.team.teamId,
    userId: auth.team.userId,
    walletAddress: auth.team.walletAddress,
    action: "ops.billing.dunning_sweep",
    resourceType: "SubscriptionState",
    metadata: sweep,
  });

  return c.json({
    ok: true,
    ...sweep,
  });
}
