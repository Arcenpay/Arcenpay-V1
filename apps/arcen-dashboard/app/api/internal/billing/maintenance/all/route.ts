/**
 * POST /api/internal/billing/maintenance/all
 *
 * Internal bulk billing maintenance entry point for scheduled automation.
 * Auth: Authorization: Bearer <FACILITATOR_SECRET>
 *
 * Body:
 *   executeDunning — optional, defaults to false
 *   limitPerTeam   — optional max subscriptions to enforce per team
 *   teamLimit      — optional max teams to process in one run
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireFacilitatorAuth } from "@/lib/facilitator-auth";
import { runBillingMaintenanceForAllTeams } from "@/lib/billing-maintenance";

const bodySchema = z.object({
  executeDunning: z.boolean().optional(),
  limitPerTeam: z.number().int().min(1).max(500).optional(),
  teamLimit: z.number().int().min(1).max(500).optional(),
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

  const result = await runBillingMaintenanceForAllTeams({
    executeDunning: parsed.data.executeDunning ?? false,
    limitPerTeam: parsed.data.limitPerTeam,
    teamLimit: parsed.data.teamLimit,
  });

  return NextResponse.json({
    ok: true,
    ...result,
  });
}
