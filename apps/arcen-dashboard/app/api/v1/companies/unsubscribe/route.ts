/**
 * POST /api/v1/companies/unsubscribe
 *
 * Cancel the authenticated company's subscription (switches to free plan).
 * Auth: Bearer <embed_access_token>
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { deliverWebhook } from "@/lib/deliver-webhook";
import { createPublicClient, http, isAddress } from "viem";
import {
  ERC7579AutopayModuleABI,
  getChain,
  getContractAddresses,
} from "@arcenpay/internal-core";
import {
  extractEmbedAccessToken,
  resolveEmbedAccessToken,
} from "@/lib/embed-access-token";
import { toPrismaJson } from "@/lib/prisma-json";
import { upsertSubscriptionLedgerState } from "@/lib/billing-ledger";
import { resolvePublishedFreePlan } from "@/lib/catalog-billing";
import {
  normalizeTxHash,
  verifyAutopayCancellationControl,
} from "@/lib/onchain-payment-verification";
import { SELF_SERVE_CANCELLATION_ENABLED } from "@/lib/launch-flags";
import { DEFAULT_CHAIN_ID } from "@/lib/default-chain";
import { getRpcUrl } from "@/lib/config";

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

async function readAutopayShutdownState(
  paymentAccount: string,
): Promise<"PAUSED" | "REVOKED" | null> {
  if (!isAddress(paymentAccount)) return null;

  const chainId = DEFAULT_CHAIN_ID;
  const contracts = getContractAddresses(chainId);
  const autopayAddress = contracts.autopayModule as `0x${string}` | undefined;
  if (!autopayAddress || !isAddress(autopayAddress)) return null;

  const publicClient = createPublicClient({
    chain: getChain(chainId),
    transport: http(getRpcUrl(chainId)),
  });

  const isInitialized = (await publicClient.readContract({
    address: autopayAddress,
    abi: ERC7579AutopayModuleABI,
    functionName: "isInitialized",
    args: [paymentAccount as `0x${string}`],
  })) as boolean;

  if (!isInitialized) return "REVOKED";

  const isPaused = (await publicClient.readContract({
    address: autopayAddress,
    abi: ERC7579AutopayModuleABI,
    functionName: "isAccountPaused",
    args: [paymentAccount as `0x${string}`],
  })) as boolean;

  return isPaused ? "PAUSED" : null;
}

import { corsHeaders } from "@/lib/cors";

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function POST(req: NextRequest) {
  if (!SELF_SERVE_CANCELLATION_ENABLED) {
    return NextResponse.json(
      {
        error:
          "Self-service cancellation is disabled for this launch. Contact support to cancel or downgrade your subscription.",
      },
      { status: 403, headers: corsHeaders() },
    );
  }

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

  let body: {
    txHash?: string;
    autopayControlTxHash?: string;
  } = {};
  try {
    body = (await req.json()) as typeof body;
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
        subscriptionState: {
          select: {
            walletAddress: true,
            currentPeriodEnd: true,
            onChainPlanId: true,
            onChainTokenId: true,
          },
        },
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
  const companyPaymentAccount =
    company.subscriptionState?.walletAddress ?? company.walletAddress ?? null;

  if (company.activePlanId && company.activePlanId !== freePlan.id) {
    const currentPlan = await db.catalogPlan.findFirst({
      where: { id: company.activePlanId, teamId },
      select: { id: true, name: true, onChainPlanId: true },
    });

    const effectiveAt = company.subscriptionState?.currentPeriodEnd ?? null;
    if (!effectiveAt || effectiveAt <= new Date()) {
      return NextResponse.json(
        {
          error:
            "The current billing period end is required before cancellation can be scheduled.",
        },
        { status: 409, headers: corsHeaders() },
      );
    }

    const normalizedAutopayTxHash = normalizeTxHash(
      body.autopayControlTxHash ?? body.txHash,
    );
    let autopayControl:
      | {
          control: "PAUSED" | "REVOKED";
          txHash?: `0x${string}`;
        }
      | null = null;
    let pendingVerification = false;

    if (currentPlan?.onChainPlanId) {
      if (!companyPaymentAccount) {
        return NextResponse.json(
          {
            error:
              "The company must have a linked payment account before an on-chain cancellation can be scheduled.",
          },
          { status: 409, headers: corsHeaders() },
        );
      }

      if (normalizedAutopayTxHash) {
        const verification = await verifyAutopayCancellationControl({
          paymentAccount: companyPaymentAccount,
          txHash: normalizedAutopayTxHash,
        });
        if (!verification.ok) {
          if (verification.status === 425) {
            const control = await readAutopayShutdownState(companyPaymentAccount);
            if (!control) {
              return NextResponse.json(
                { error: verification.error },
                { status: verification.status, headers: corsHeaders() },
              );
            }

            pendingVerification = true;
            autopayControl = {
              control,
              txHash: normalizedAutopayTxHash,
            };
          } else {
            return NextResponse.json(
              { error: verification.error },
              { status: verification.status, headers: corsHeaders() },
            );
          }
        } else {
          autopayControl = {
            control: verification.control,
            txHash: verification.txHash,
          };
        }
      } else {
        const control = await readAutopayShutdownState(companyPaymentAccount);
        if (!control) {
          return NextResponse.json(
            {
              error:
                "Scheduled paid subscription cancellation requires a confirmed AutopayModule.pauseAccount or onUninstall transaction hash, unless autopay is already paused or revoked.",
            },
            { status: 400, headers: corsHeaders() },
          );
        }
        autopayControl = { control };
      }
    }

    const transition = {
      mode: "cancel_at_period_end",
      targetPlanId: freePlan.id,
      targetPlanName: freePlan.name,
      previousPlanId: company.activePlanId,
      requestedAt: new Date().toISOString(),
      effectiveAt: effectiveAt.toISOString(),
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

    await upsertSubscriptionLedgerState({
      teamId,
      companyId,
      walletAddress: companyPaymentAccount,
      status: "ACTIVE",
      catalogPlanId: company.activePlanId,
      onChainPlanId:
        company.subscriptionState?.onChainPlanId ??
        currentPlan?.onChainPlanId ??
        null,
      onChainTokenId: company.subscriptionState?.onChainTokenId ?? null,
      currentPeriodEnd: effectiveAt,
      cancelAtPeriodEnd: true,
      cancelledAt: null,
      pastDueAt: null,
      graceEndsAt: null,
      lastEvent: "subscription.cancel_scheduled",
      lastEventAt: new Date(),
      lastSourceTxHash: normalizedAutopayTxHash,
        metadata: {
          source: "self_service",
          fallbackPlanId: freePlan.id,
          previousCatalogPlanId: company.activePlanId,
          pendingVerification,
          autopayControl: autopayControl
            ? {
              control: autopayControl.control,
              txHash: autopayControl.txHash ?? null,
            }
          : null,
      },
    });

    deliverWebhook(teamId, "company.plan.cancelled", {
      companyId,
      previousPlanId: company.activePlanId,
      fallbackPlanId: freePlan.id,
      mode: "cancel_at_period_end",
      scheduled: true,
        effectiveAt: effectiveAt.toISOString(),
        autopayControlTxHash: normalizedAutopayTxHash,
        autopayControl: autopayControl?.control ?? null,
        pendingVerification,
      }).catch(() => {});

    deliverWebhook(teamId, "company.plan.changed", {
      companyId,
      previousPlanId: company.activePlanId,
      planId: company.activePlanId,
      planName: currentPlan?.name ?? null,
      fallbackPlanId: freePlan.id,
      mode: "cancel_at_period_end",
      scheduled: true,
        effectiveAt: effectiveAt.toISOString(),
        cancellation: true,
        pendingVerification,
      }).catch(() => {});

    return NextResponse.json(
      {
        data: {
          success: true,
          scheduled: true,
          mode: "cancel_at_period_end",
          planId: company.activePlanId,
          fallbackPlanId: freePlan.id,
          effectiveAt: effectiveAt.toISOString(),
          autopayControlTxHash: normalizedAutopayTxHash,
          autopayControl: autopayControl?.control ?? null,
          pendingVerification,
        },
      },
      {
        status: pendingVerification ? 202 : 200,
        headers: corsHeaders(),
      },
    );
  }

  if (!company.activePlanId || company.activePlanId === freePlan.id) {
    const nextTraits = { ...currentTraits };
    delete nextTraits.subscriptionTransition;
    delete nextTraits.billingPeriod;

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
