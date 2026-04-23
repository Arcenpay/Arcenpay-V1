/**
 * POST /api/v1/companies/plan
 *
 * Switch the authenticated company's active plan.
 * Auth: Bearer <embed_access_token>
 * Body: { planId: string }
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { deliverWebhook } from "@/lib/deliver-webhook";
import { resolveEntitlementResults } from "@/lib/entitlements";
import {
  extractEmbedAccessToken,
  resolveEmbedAccessToken,
} from "@/lib/embed-access-token";
import { toPrismaJson } from "@/lib/prisma-json";
import {
  incrementCouponRedemption,
  normalizeBillingPeriod,
  normalizeCouponCode,
  resolvePlanAmountMicros,
  resolveCouponQuote,
} from "@/lib/catalog-billing";
import { upsertSubscriptionLedgerState } from "@/lib/billing-ledger";
import {
  normalizeTxHash,
  verifyAutopayPlanChange,
  verifyDirectErc20Transfer,
} from "@/lib/onchain-payment-verification";

type SubscriptionTransition = {
  mode: "period_end_downgrade" | "cancel_at_period_end";
  targetPlanId: string | null;
  targetPlanName: string | null;
  previousPlanId: string | null;
  requestedAt: string;
  effectiveAt: string | null;
  source: "self_service";
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readConsumedPaymentTxHashes(
  traits: Record<string, unknown>,
): string[] {
  const txHashes = traits.billingVerifiedTxHashes;
  if (!Array.isArray(txHashes)) return [];
  return txHashes.filter(
    (value): value is string =>
      typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value),
  );
}

function readTargetNumericLimitsFromPlanMetadata(
  metadata: unknown,
): Map<string, number> {
  const limits = new Map<string, number>();
  const data = asRecord(metadata);
  const rawEntitlements = data.entitlements;
  if (!Array.isArray(rawEntitlements)) return limits;

  for (const entry of rawEntitlements) {
    const item = asRecord(entry);
    if (item.enabled !== true) continue;
    if (item.type !== "NUMERIC") continue;

    const featureKey =
      typeof item.featureKey === "string" ? item.featureKey : null;
    const limit = Number(item.value);

    if (!featureKey || !Number.isFinite(limit) || limit < 0) continue;
    limits.set(featureKey, limit);
  }

  return limits;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
  };
}

async function verifySelfServePlanPayment(params: {
  teamId: string;
  senderWallet: string;
  acceptedToken: string;
  txHash: `0x${string}`;
  expectedAmountMicros: number;
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const owner = await db.teamMember.findFirst({
    where: { teamId: params.teamId, role: "OWNER" },
    select: { user: { select: { walletAddress: true } } },
  });
  const providerWallet = owner?.user?.walletAddress?.toLowerCase();

  if (!providerWallet) {
    return {
      ok: false,
      status: 409,
      error:
        "Provider wallet is not configured for this workspace. Link the owner wallet before accepting self-serve payments.",
    };
  }

  const verification = await verifyDirectErc20Transfer({
    acceptedToken: params.acceptedToken,
    txHash: params.txHash,
    expectedAmountAtomic: BigInt(params.expectedAmountMicros),
    recipientWallet: providerWallet,
    senderWallet: params.senderWallet,
  });

  if (!verification.ok) return verification;
  return { ok: true };
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
      { error: "Invalid or expired token" },
      { status: 401, headers: corsHeaders() },
    );

  const { teamId, companyId } = decoded;
  if (!companyId)
    return NextResponse.json(
      { error: "No company associated with this token" },
      { status: 400, headers: corsHeaders() },
    );

  let body: {
    planId?: string;
    billingPeriod?: string;
    txHash?: string;
    scheduleAtPeriodEnd?: boolean;
    couponCode?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON" },
      { status: 400, headers: corsHeaders() },
    );
  }

  const {
    planId,
    billingPeriod,
    txHash,
    scheduleAtPeriodEnd,
    couponCode,
  } = body;
  if (!planId)
    return NextResponse.json(
      { error: "planId is required" },
      { status: 400, headers: corsHeaders() },
    );

  // Verify the plan belongs to this team and is published
  const plan = await db.catalogPlan.findFirst({
    where: { id: planId, teamId, status: "PUBLISHED", active: true },
    select: {
      id: true,
      name: true,
      price: true,
      annualPrice: true,
      acceptedToken: true,
      onChainPlanId: true,
      metadata: true,
    },
  });
  if (!plan)
    return NextResponse.json(
      { error: "Plan not found or not published" },
      { status: 404, headers: corsHeaders() },
    );

  const company = await db.arcenCompany.findUnique({
    where: { id: companyId },
    select: {
      id: true,
      activePlanId: true,
      traits: true,
      walletAddress: true,
      email: true,
    },
  });
  if (!company) {
    return NextResponse.json(
      { error: "Company not found" },
      { status: 404, headers: corsHeaders() },
    );
  }

  const [currentPlan, catalogConfig] = await Promise.all([
    company.activePlanId
      ? db.catalogPlan.findFirst({
          where: { id: company.activePlanId, teamId },
          select: {
            id: true,
            name: true,
            price: true,
            annualPrice: true,
            onChainPlanId: true,
          },
        })
      : Promise.resolve(null),
    db.catalogConfig.findFirst({
      where: { teamId },
      orderBy: { updatedAt: "desc" },
      select: {
        downgradeImmediately: true,
        preventDowngradeOverLimit: true,
        disallowSelfServiceDowngrade: true,
      },
    }),
  ]);

  const previousPlanId = company.activePlanId;
  if (previousPlanId === plan.id) {
    return NextResponse.json(
      {
        data: {
          success: true,
          planId: plan.id,
          planName: plan.name,
          mode: "no_change",
        },
      },
      { headers: corsHeaders() },
    );
  }

  const currentPrice = Number(currentPlan?.price ?? 0);
  const targetPrice = Number(plan.price);
  if (currentPrice > 0 || targetPrice > 0) {
    return NextResponse.json(
      {
        error:
          "Self-service paid plan changes are temporarily blocked because this endpoint does not update the authoritative on-chain subscription. Use the on-chain subscription flow and then sync the dashboard state.",
      },
      { status: 409, headers: corsHeaders() },
    );
  }

  const isDowngrade = !!currentPlan && targetPrice < currentPrice;
  const normalizedBillingPeriod = normalizeBillingPeriod(billingPeriod);
  const shouldScheduleDowngrade =
    isDowngrade &&
    (scheduleAtPeriodEnd ?? !(catalogConfig?.downgradeImmediately ?? false));
  const currentPlanAmountMicros = currentPlan
    ? resolvePlanAmountMicros(currentPlan, normalizedBillingPeriod)
    : 0;
  const targetPlanAmountMicros = resolvePlanAmountMicros(
    plan,
    normalizedBillingPeriod,
  );
  const usesAuthoritativeOnChainPlanChange =
    Boolean(currentPlan?.onChainPlanId) || Boolean(plan.onChainPlanId);

  const quoteResult = await resolveCouponQuote({
    teamId,
    planId: plan.id,
    billingPeriod: normalizedBillingPeriod,
    couponCode,
  });
  if (!quoteResult.ok) {
    return NextResponse.json(
      { error: quoteResult.error },
      { status: quoteResult.status, headers: corsHeaders() },
    );
  }
  const normalizedCouponCode = normalizeCouponCode(couponCode);
  const quotedAmountMicros = quoteResult.quote.finalAmountMicros;

  if (usesAuthoritativeOnChainPlanChange) {
    if (!currentPlan?.onChainPlanId) {
      return NextResponse.json(
        {
          error:
            "Upgrading from a free or off-chain plan into an on-chain subscription must use the subscription checkout flow, not the self-serve plan-change endpoint.",
        },
        { status: 409, headers: corsHeaders() },
      );
    }

    if (!plan.onChainPlanId) {
      return NextResponse.json(
        {
          error:
            "Moving from an on-chain paid subscription to a free or off-chain plan must use the subscription cancellation flow first so future billing stops authoritatively.",
        },
        { status: 409, headers: corsHeaders() },
      );
    }

    if (shouldScheduleDowngrade || scheduleAtPeriodEnd) {
      return NextResponse.json(
        {
          error:
            "Scheduled paid plan changes are not enabled yet. Execute the authoritative on-chain plan change when you are ready for the new plan to take effect.",
        },
        { status: 409, headers: corsHeaders() },
      );
    }

    if (normalizedCouponCode) {
      return NextResponse.json(
        {
          error:
            "Coupons are not supported for authoritative on-chain plan changes yet because discount state is not carried into the recurring subscription config.",
        },
        { status: 409, headers: corsHeaders() },
      );
    }

    if (currentPlanAmountMicros !== targetPlanAmountMicros) {
      return NextResponse.json(
        {
          error:
            "Price-changing paid plan changes are not enabled yet because the required proration and refund logic is not implemented end to end. Only equal-price on-chain plan changes are currently supported.",
        },
        { status: 409, headers: corsHeaders() },
      );
    }

    if (quotedAmountMicros !== targetPlanAmountMicros) {
      return NextResponse.json(
        {
          error:
            "The quoted amount does not match the canonical plan amount. Refresh billing state and try again.",
        },
        { status: 409, headers: corsHeaders() },
      );
    }
  }

  if (isDowngrade && (catalogConfig?.disallowSelfServiceDowngrade ?? false)) {
    return NextResponse.json(
      {
        error:
          "Self-service downgrades are disabled for this billing catalog. Contact support.",
      },
      { status: 403, headers: corsHeaders() },
    );
  }

  if (isDowngrade && (catalogConfig?.preventDowngradeOverLimit ?? true)) {
    const targetNumericLimits = readTargetNumericLimitsFromPlanMetadata(
      plan.metadata,
    );

    if (targetNumericLimits.size > 0) {
      const entitlementResults = await resolveEntitlementResults({
        teamId,
        companyKeys: {
          internalId: company.id,
          wallet: company.walletAddress ?? undefined,
          email: company.email ?? undefined,
        },
      });

      const overages = entitlementResults.entitlements
        .map((entitlement) => {
          const limit = targetNumericLimits.get(entitlement.key);
          if (typeof limit !== "number") return null;
          const usage = entitlement.usage ?? 0;
          if (usage <= limit) return null;

          return {
            featureKey: entitlement.key,
            usage,
            limit,
          };
        })
        .filter(
          (
            item,
          ): item is { featureKey: string; usage: number; limit: number } =>
            !!item,
        );

      if (overages.length > 0) {
        return NextResponse.json(
          {
            error:
              "Downgrade blocked because current usage exceeds the selected plan limits.",
            details: overages,
          },
          { status: 409, headers: corsHeaders() },
        );
      }
    }
  }

  const currentTraits = asRecord(company.traits);
  const consumedPaymentTxHashes = readConsumedPaymentTxHashes(currentTraits);

  if (usesAuthoritativeOnChainPlanChange) {
    if (!company.walletAddress) {
      return NextResponse.json(
        {
          error:
            "The company must have a linked payment account before an on-chain plan change can be verified.",
        },
        { status: 409, headers: corsHeaders() },
      );
    }

    const normalizedTxHash = normalizeTxHash(txHash);
    if (!normalizedTxHash) {
      return NextResponse.json(
        {
          error:
            "Authoritative on-chain plan changes require the confirmed AutopayModule.updateConfig transaction hash.",
        },
        { status: 400, headers: corsHeaders() },
      );
    }

    if (consumedPaymentTxHashes.includes(normalizedTxHash)) {
      return NextResponse.json(
        {
          error:
            "This on-chain plan change transaction hash has already been used for a previous plan change.",
        },
        { status: 409, headers: corsHeaders() },
      );
    }

    const verification = await verifyAutopayPlanChange({
      paymentAccount: company.walletAddress,
      txHash: normalizedTxHash,
      expectedOnChainPlanId: plan.onChainPlanId!,
    });
    if (!verification.ok) {
      return NextResponse.json(
        { error: verification.error },
        { status: verification.status, headers: corsHeaders() },
      );
    }

    const nextTraits: Record<string, unknown> = {
      ...currentTraits,
      billingVerifiedTxHashes: [
        ...consumedPaymentTxHashes,
        normalizedTxHash,
      ].slice(-20),
    };
    delete nextTraits.subscriptionTransition;

    await db.arcenCompany.update({
      where: { id: companyId },
      data: {
        activePlanId: planId,
        walletAddress: company.walletAddress.toLowerCase(),
        traits: toPrismaJson(nextTraits),
      },
    });

    await upsertSubscriptionLedgerState({
      teamId,
      companyId,
      walletAddress: company.walletAddress,
      status: "ACTIVE",
      catalogPlanId: plan.id,
      onChainPlanId: verification.onChainPlanId,
      onChainTokenId: verification.tokenId,
      currentPeriodEnd: new Date(verification.currentPeriodEnd),
      cancelAtPeriodEnd: false,
      cancelledAt: null,
      pastDueAt: null,
      graceEndsAt: null,
      lastEvent: "subscription.plan_changed",
      lastEventAt: new Date(),
      lastSourceTxHash: normalizedTxHash,
      metadata: {
        source: "self_service",
        previousCatalogPlanId: previousPlanId ?? null,
        previousOnChainPlanId: verification.previousOnChainPlanId,
      },
    });

    deliverWebhook(teamId, "company.plan.changed", {
      companyId,
      planId,
      planName: plan.name,
      billingPeriod: normalizedBillingPeriod,
      previousPlanId: previousPlanId ?? null,
      mode: "immediate",
      scheduled: false,
      txHash: normalizedTxHash,
      onChainPlanId: verification.onChainPlanId,
      verifiedOnChain: true,
    }).catch(() => {});

    return NextResponse.json(
      {
        data: {
          success: true,
          scheduled: false,
          mode: "immediate_on_chain",
          planId,
          planName: plan.name,
          previousPlanId: previousPlanId ?? null,
          onChainPlanId: verification.onChainPlanId,
          tokenId: verification.tokenId,
          currentPeriodEnd: verification.currentPeriodEnd,
        },
      },
      { headers: corsHeaders() },
    );
  }

  if (!shouldScheduleDowngrade && quotedAmountMicros > 0) {
    if (!company.walletAddress) {
      return NextResponse.json(
        {
          error:
            "The company must have a linked wallet before a self-serve paid plan change can be verified.",
        },
        { status: 409, headers: corsHeaders() },
      );
    }

    const normalizedTxHash = normalizeTxHash(txHash);
    if (!normalizedTxHash) {
      return NextResponse.json(
        {
          error:
            "Paid plan changes require a confirmed payment transaction hash.",
        },
        { status: 400, headers: corsHeaders() },
      );
    }

    if (consumedPaymentTxHashes.includes(normalizedTxHash)) {
      return NextResponse.json(
        {
          error:
            "This payment transaction hash has already been used for a previous plan change.",
        },
        { status: 409, headers: corsHeaders() },
      );
    }

    const paymentCheck = await verifySelfServePlanPayment({
      teamId,
      senderWallet: company.walletAddress,
      acceptedToken: plan.acceptedToken,
      txHash: normalizedTxHash,
      expectedAmountMicros: quotedAmountMicros,
    });
    if (!paymentCheck.ok) {
      return NextResponse.json(
        { error: paymentCheck.error },
        { status: paymentCheck.status, headers: corsHeaders() },
      );
    }
  }

  if (shouldScheduleDowngrade) {
    const transition: SubscriptionTransition = {
      mode: "period_end_downgrade",
      targetPlanId: plan.id,
      targetPlanName: plan.name,
      previousPlanId: previousPlanId ?? null,
      requestedAt: new Date().toISOString(),
      effectiveAt: null,
      source: "self_service",
    };

    await db.arcenCompany.update({
      where: { id: companyId },
      data: {
        traits: toPrismaJson({
          ...currentTraits,
          subscriptionTransition: transition,
        }),
      },
    });

    deliverWebhook(teamId, "company.plan.changed", {
      companyId,
      planId,
      planName: plan.name,
      billingPeriod: normalizedBillingPeriod,
      previousPlanId: previousPlanId ?? null,
      mode: "period_end",
      scheduled: true,
      ...(normalizedCouponCode ? { couponCode: normalizedCouponCode } : {}),
    }).catch(() => {});

    return NextResponse.json(
      {
        data: {
          success: true,
          scheduled: true,
          mode: "period_end",
          planId,
          planName: plan.name,
          previousPlanId: previousPlanId ?? null,
          effectiveAt: null,
        },
      },
      { headers: corsHeaders() },
    );
  }

  const nextTraits = { ...currentTraits };
  delete nextTraits.subscriptionTransition;
  if (txHash) {
    const normalizedAppliedTxHash = normalizeTxHash(txHash);
    if (normalizedAppliedTxHash) {
      nextTraits.billingVerifiedTxHashes = [
        ...consumedPaymentTxHashes,
        normalizedAppliedTxHash,
      ].slice(-20);
    }
  }

  // Update the company's active plan
  await db.arcenCompany.update({
    where: { id: companyId },
    data: {
      activePlanId: planId,
      traits: toPrismaJson(nextTraits),
    },
  });

  if (normalizedCouponCode) {
    await incrementCouponRedemption(teamId, normalizedCouponCode);
  }

  // Fire outbound webhook (non-blocking)
  deliverWebhook(teamId, "company.plan.changed", {
    companyId,
    planId,
    planName: plan.name,
    billingPeriod: normalizedBillingPeriod,
    previousPlanId: previousPlanId ?? null,
    mode: "immediate",
    scheduled: false,
    chargedAmount: quoteResult.quote.finalAmount,
    ...(txHash ? { txHash } : {}),
    ...(normalizedCouponCode ? { couponCode: normalizedCouponCode } : {}),
  }).catch(() => {});

  return NextResponse.json(
    {
      data: {
        success: true,
        scheduled: false,
        mode: "immediate",
        planId,
        planName: plan.name,
        previousPlanId: previousPlanId ?? null,
      },
    },
    { headers: corsHeaders() },
  );
}
