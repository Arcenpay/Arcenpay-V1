import type { Context } from "hono";
import { z } from "zod";
import { db } from "../../../db.js";
import { requireFacilitatorAuth } from "../../../lib/auth/facilitator-auth.js";
import { runBillingMaintenance } from "../../../lib/billing/billing-maintenance.js";

const bodySchema = z.object({
  teamId: z.string().min(1),
  executeDunning: z.boolean().optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

export async function runMaintenance(c: Context) {
  const authError = requireFacilitatorAuth(c.req.raw.headers);
  if (authError) return c.json({ error: authError.error }, authError.status as any as any as any);

  const body = await c.req.json() .catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors }, 400 as any);
  }

  const result = await runBillingMaintenance({
    teamId: parsed.data.teamId,
    executeDunning: parsed.data.executeDunning ?? false,
    limit: parsed.data.limit,
  });

  return c.json({
    ok: true,
    ...result,
  });
}
