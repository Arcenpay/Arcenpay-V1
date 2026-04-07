/**
 * PATCH /api/internal/companies/sync-subscription
 *
 * Called by the facilitator when a subscription event is detected on-chain.
 * Updates company.activePlanId based on the event type.
 *
 * Auth: Authorization: Bearer <FACILITATOR_SECRET>
 *
 * Body:
 *   wallet        — subscriber wallet address
 *   onChainPlanId — the planId from PlanFactory.sol (null for cancellation)
 *   event         — 'minted' | 'renewed' | 'cancelled'
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";
import { toPrismaJson } from "@/lib/prisma-json";

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

const bodySchema = z.object({
  wallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/i),
  onChainPlanId: z.string().nullable(),
  event: z.enum(["minted", "renewed", "cancelled"]),
});

export async function PATCH(req: NextRequest) {
  const facilitatorSecret = process.env.FACILITATOR_SECRET ?? "";
  const dashboardTeamId = process.env.DASHBOARD_TEAM_ID ?? "";
  const auth = req.headers.get("authorization") ?? "";
  if (!facilitatorSecret || auth !== `Bearer ${facilitatorSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { wallet, onChainPlanId, event } = parsed.data;

  const company = await db.arcenCompany.findFirst({
    where: {
      walletAddress: wallet.toLowerCase(),
      ...(dashboardTeamId ? { teamId: dashboardTeamId } : {}),
    },
    select: { id: true, teamId: true, traits: true, activePlanId: true },
  });

  if (!company) {
    return NextResponse.json(
      { error: "Company not found for wallet" },
      { status: 404 },
    );
  }

  if (event === "cancelled") {
    const traits = asRecord(company.traits);
    const transition = asRecord(traits.subscriptionTransition);
    const transitionTargetPlanId =
      typeof transition.targetPlanId === "string"
        ? transition.targetPlanId
        : null;

    let resolvedPlanId: string | null = null;
    if (transitionTargetPlanId) {
      const targetPlan = await db.catalogPlan.findFirst({
        where: {
          id: transitionTargetPlanId,
          teamId: company.teamId,
          status: "PUBLISHED",
          active: true,
        },
        select: { id: true },
      });
      resolvedPlanId = targetPlan?.id ?? null;
    }

    if (!resolvedPlanId) {
      const fallbackPlan = await db.catalogPlan.findFirst({
        where: { teamId: company.teamId, status: "PUBLISHED", active: true },
        orderBy: [{ price: "asc" }],
        select: { id: true },
      });
      resolvedPlanId = fallbackPlan?.id ?? null;
    }

    const nextTraits = { ...traits };
    delete nextTraits.subscriptionTransition;

    await db.arcenCompany.update({
      where: { id: company.id },
      data: {
        activePlanId: resolvedPlanId,
        traits: toPrismaJson(nextTraits),
      },
    });
    return NextResponse.json({
      ok: true,
      activePlanId: resolvedPlanId,
      transitionResolved: true,
    });
  }

  // minted | renewed — resolve the on-chain plan to our internal plan
  const plan = await db.catalogPlan.findFirst({
    where: { onChainPlanId, teamId: company.teamId },
    select: { id: true },
  });

  if (!plan) {
    console.warn(
      `[SyncSubscription] No CatalogPlan found for onChainPlanId=${onChainPlanId} teamId=${company.teamId}`,
    );
    return NextResponse.json(
      { ok: false, error: "Plan not found for onChainPlanId" },
      { status: 404 },
    );
  }

  const traits = asRecord(company.traits);
  const nextTraits = { ...traits };
  delete nextTraits.subscriptionTransition;

  await db.arcenCompany.update({
    where: { id: company.id },
    data: {
      activePlanId: plan.id,
      traits: toPrismaJson(nextTraits),
    },
  });

  return NextResponse.json({ ok: true, activePlanId: plan.id });
}
