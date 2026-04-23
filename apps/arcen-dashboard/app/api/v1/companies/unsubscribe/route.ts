/**
 * POST /api/v1/companies/unsubscribe
 *
 * Cancel the authenticated company's subscription (switches to free plan).
 * Auth: Bearer <embed_access_token>
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { deliverWebhook } from "@/lib/deliver-webhook";
import {
  extractEmbedAccessToken,
  resolveEmbedAccessToken,
} from "@/lib/embed-access-token";
import { toPrismaJson } from "@/lib/prisma-json";
import { upsertSubscriptionLedgerState } from "@/lib/billing-ledger";
import { resolvePublishedFreePlan } from "@/lib/catalog-billing";
import {
  normalizeTxHash,
  verifySubscriptionCancellation,
} from "@/lib/onchain-payment-verification";

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function POST(req: NextRequest) {
  const token = extractEmbedAccessToken(req);
  if (!token)
    return NextResponse.json(
      { error: "Access token required" },
      { status: 401, headers: corsHeaders() },
    );

  if (!process.env.ACCESS_TOKEN_SECRET)
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500, headers: corsHeaders() },
    );

  const decoded = await resolveEmbedAccessToken(token);
  if (!decoded?.teamId)
    return NextResponse.json(
      { error: "Invalid token" },
      { status: 401, headers: corsHeaders() },
    );

  const { teamId, companyId } = decoded;
  if (!companyId)
    return NextResponse.json(
      { error: "No company" },
      { status: 400, headers: corsHeaders() },
    );

  let body: { txHash?: string } = {};
  try {
    body = (await req.json()) as { txHash?: string };
  } catch {
    body = {};
  }

  const [company, freePlan] = await Promise.all([
    db.arcenCompany.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        activePlanId: true,
        traits: true,
        walletAddress: true,
      },
    }),
    resolvePublishedFreePlan(teamId),
  ]);

  if (!company) {
    return NextResponse.json(
      { error: "Company not found" },
      { status: 404, headers: corsHeaders() },
    );
  }

  if (!freePlan) {
    return NextResponse.json(
      {
        error:
          "No published fallback plan is available. Publish a free plan before allowing self-service cancellation.",
      },
      { status: 409, headers: corsHeaders() },
    );
  }

  const currentTraits = asRecord(company.traits);

  if (company.activePlanId && company.activePlanId !== freePlan.id) {
    if (!company.walletAddress) {
      return NextResponse.json(
        {
          error:
            "The company must have a linked payment account before an on-chain cancellation can be verified.",
        },
        { status: 409, headers: corsHeaders() },
      );
    }

    const normalizedTxHash = normalizeTxHash(body.txHash);
    if (!normalizedTxHash) {
      return NextResponse.json(
        {
          error:
            "Paid subscription cancellation requires the confirmed on-chain SubscriptionRegistry.cancelSubscription transaction hash.",
        },
        { status: 400, headers: corsHeaders() },
      );
    }

    const verification = await verifySubscriptionCancellation({
      paymentAccount: company.walletAddress,
      txHash: normalizedTxHash,
    });
    if (!verification.ok) {
      return NextResponse.json(
        { error: verification.error },
        { status: verification.status, headers: corsHeaders() },
      );
    }

    const nextTraits: Record<string, unknown> = { ...currentTraits };
    delete nextTraits.subscriptionTransition;

    await db.arcenCompany.update({
      where: { id: companyId },
      data: {
        activePlanId: freePlan.id,
        traits: toPrismaJson(nextTraits),
      },
    });

    await upsertSubscriptionLedgerState({
      teamId,
      companyId,
      walletAddress: company.walletAddress,
      status: "CANCELLED",
      catalogPlanId: freePlan.id,
      onChainPlanId: null,
      onChainTokenId: verification.tokenId,
      currentPeriodEnd: new Date(verification.cancelledAt),
      cancelAtPeriodEnd: false,
      cancelledAt: new Date(verification.cancelledAt),
      pastDueAt: null,
      graceEndsAt: null,
      lastEvent: "subscription.cancelled",
      lastEventAt: new Date(),
      lastSourceTxHash: normalizedTxHash,
      metadata: {
        source: "self_service",
        previousCatalogPlanId: company.activePlanId,
        previousOnChainPlanId: verification.onChainPlanId,
      },
    });

    deliverWebhook(teamId, "company.plan.cancelled", {
      companyId,
      previousPlanId: company.activePlanId,
      fallbackPlanId: freePlan.id,
      txHash: normalizedTxHash,
      onChainPlanId: verification.onChainPlanId,
      tokenId: verification.tokenId,
      cancelledAt: verification.cancelledAt,
    }).catch(() => {});

    deliverWebhook(teamId, "company.plan.changed", {
      companyId,
      previousPlanId: company.activePlanId,
      planId: freePlan.id,
      planName: freePlan.name,
      mode: "immediate",
      scheduled: false,
      txHash: normalizedTxHash,
      cancellation: true,
    }).catch(() => {});

    return NextResponse.json(
      {
        data: {
          success: true,
          scheduled: false,
          mode: "cancelled_on_chain",
          planId: freePlan.id,
          tokenId: verification.tokenId,
          cancelledAt: verification.cancelledAt,
        },
      },
      { headers: corsHeaders() },
    );
  }

  if (!company.activePlanId || company.activePlanId === freePlan.id) {
    const nextTraits = { ...currentTraits };
    delete nextTraits.subscriptionTransition;

    await db.arcenCompany.update({
      where: { id: companyId },
      data: {
        activePlanId: freePlan.id,
        traits: toPrismaJson(nextTraits),
      },
    });

    return NextResponse.json(
      {
        data: {
          success: true,
          scheduled: false,
          mode: "already_free",
          planId: freePlan.id,
        },
      },
      { headers: corsHeaders() },
    );
  }

  return NextResponse.json(
    {
      error:
        "Cancellation state is inconsistent. Sync the on-chain subscription before retrying.",
    },
    { status: 409, headers: corsHeaders() },
  );
}
