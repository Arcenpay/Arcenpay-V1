import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireFacilitatorAuth } from "@/lib/facilitator-auth";

const querySchema = z.object({
  onChainPlanId: z.string().min(1),
  teamId: z.string().min(1).optional(),
  environmentMode: z.enum(["DEVELOPMENT", "PRODUCTION"]).optional(),
});

export async function GET(req: NextRequest) {
  const authError = requireFacilitatorAuth(req);
  if (authError) return authError;

  const parsed = querySchema.safeParse({
    onChainPlanId: req.nextUrl.searchParams.get("onChainPlanId"),
    teamId: req.nextUrl.searchParams.get("teamId") ?? undefined,
    environmentMode:
      req.nextUrl.searchParams.get("environmentMode") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const matches = await db.catalogPlan.findMany({
    where: {
      onChainPlanId: parsed.data.onChainPlanId,
      ...(parsed.data.teamId ? { teamId: parsed.data.teamId } : {}),
      environmentMode: parsed.data.environmentMode ?? "PRODUCTION",
      status: "PUBLISHED",
      active: true,
    },
    select: { id: true, teamId: true, onChainPlanId: true },
    take: 2,
  });

  if (matches.length === 0) {
    return NextResponse.json(
      { error: "Plan not found for onChainPlanId" },
      { status: 404 },
    );
  }

  if (matches.length > 1) {
    return NextResponse.json(
      { error: "Multiple teams match this onChainPlanId." },
      { status: 409 },
    );
  }

  return NextResponse.json({
    ok: true,
    teamId: matches[0].teamId,
    planId: matches[0].id,
    onChainPlanId: matches[0].onChainPlanId,
  });
}
