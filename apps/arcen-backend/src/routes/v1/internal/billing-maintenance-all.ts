import type { Context } from "hono";
import { z } from "zod";
import { runBillingMaintenanceForAllTeams } from "../../../lib/billing/billing-maintenance.js";

const bodySchema = z.object({
  executeDunning: z.boolean().optional(),
  limitPerTeam: z.number().int().min(1).max(500).optional(),
  teamLimit: z.number().int().min(1).max(500).optional(),
});

export async function runMaintenanceAll(c: Context) {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return c.json({ error: "Invalid request body" }, 400 as any);
  }
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
