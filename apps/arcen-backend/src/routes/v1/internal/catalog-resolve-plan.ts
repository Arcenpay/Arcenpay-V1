import type { Context } from "hono";
import { z } from "zod";
import { db } from "../../../db.js";
import { requireFacilitatorAuth } from "../../../lib/auth/facilitator-auth.js";

const querySchema = z.object({
  onChainPlanId: z.string().min(1),
  teamId: z.string().min(1).optional(),
  environmentMode: z.enum(["DEVELOPMENT", "PRODUCTION"]).optional(),
});

export async function resolvePlan(c: Context) {
  const authError = requireFacilitatorAuth(c.req.raw.headers);
  if (authError) return c.json({ error: authError.error }, authError.status as any as any as any);

  const parsed = querySchema.safeParse({
    onChainPlanId: c.req.query("onChainPlanId"),
    teamId: c.req.query("teamId") ?? undefined,
    environmentMode: c.req.query("environmentMode") ?? undefined,
  });

  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors }, 400 as any);
  }

  const matches = await db.catalogPlan.findMany({
    where: {
      onChainPlanId: parsed.data.onChainPlanId,
      ...(parsed.data.teamId ? { teamId: parsed.data.teamId } : {}),
      ...(parsed.data.environmentMode
        ? { environmentMode: parsed.data.environmentMode }
        : {}),
      status: "PUBLISHED",
      active: true,
    },
    select: { id: true, teamId: true, onChainPlanId: true },
    take: 2,
  });

  if (matches.length === 0) {
    return c.json({ error: "Plan not found for onChainPlanId" }, 404 as any);
  }

  if (matches.length > 1) {
    return c.json({ error: "Multiple teams match this onChainPlanId." }, 409 as any);
  }

  return c.json({
    ok: true,
    teamId: matches[0].teamId,
    planId: matches[0].id,
    onChainPlanId: matches[0].onChainPlanId,
  });
}
