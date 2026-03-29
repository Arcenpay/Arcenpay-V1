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

const bodySchema = z.object({
  wallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/i),
  onChainPlanId: z.string().nullable(),
  event: z.enum(["minted", "renewed", "cancelled"]),
});

export async function PATCH(req: NextRequest) {
  const facilitatorSecret = process.env.FACILITATOR_SECRET ?? "";
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
    where: { walletAddress: wallet.toLowerCase() },
    select: { id: true, teamId: true },
  });

  if (!company) {
    return NextResponse.json(
      { error: "Company not found for wallet" },
      { status: 404 },
    );
  }

  if (event === "cancelled") {
    await db.arcenCompany.update({
      where: { id: company.id },
      data: { activePlanId: null },
    });
    return NextResponse.json({ ok: true, activePlanId: null });
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

  await db.arcenCompany.update({
    where: { id: company.id },
    data: { activePlanId: plan.id },
  });

  return NextResponse.json({ ok: true, activePlanId: plan.id });
}
