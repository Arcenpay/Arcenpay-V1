/**
 * POST /api/internal/billing/maintenance
 *
 * Internal billing maintenance entry point for scheduled automation.
 * Auth: Authorization: Bearer <FACILITATOR_SECRET>
 *
 * Body:
 *   teamId          — required workspace identifier
 *   executeDunning  — optional, defaults to false
 *   limit           — optional max subscriptions to enforce in one sweep
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireFacilitatorAuth } from "@/lib/facilitator-auth";
import { runBillingMaintenance } from "@/lib/billing-maintenance";

const bodySchema = z.object({
  teamId: z.string().min(1),
  executeDunning: z.boolean().optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

export async function POST(req: NextRequest) {
  const authError = requireFacilitatorAuth(req);
  if (authError) return authError;

  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const result = await runBillingMaintenance({
    teamId: parsed.data.teamId,
    executeDunning: parsed.data.executeDunning ?? false,
    limit: parsed.data.limit,
  });

  return NextResponse.json({
    ok: true,
    ...result,
  });
}
