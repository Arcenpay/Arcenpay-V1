import type { Context } from "hono";
import { z } from "zod";
import { requireFacilitatorAuth } from "../../../lib/auth/facilitator-auth.js";
import { runBillingMaintenanceForAllTeams } from "../../../lib/billing/billing-maintenance.js";

const bodySchema = z.object({
  executeDunning: z.boolean().optional(),
  limitPerTeam: z.number().int().min(1).max(500).optional(),
  teamLimit: z.number().int().min(1).max(500).optional(),
});

export async function runMaintenanceAll(c: Context) {
  const authError = requireFacilitatorAuth(c.req.raw.headers);
  if (authError) return c.json({ error: authError.error }, authError.status as any as any as any);

  const body = await c.req.json() .catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors }, 400 as any);
  }

  const result = await runBillingMaintenanceForAllTeams({
    executeDunning: parsed.data.executeDunning ?? false,
    limitPerTeam: parsed.data.limitPerTeam,
    teamLimit: parsed.data.teamLimit,
  });

  return c.json({
    ok: true,
    ...result,
  });
}
