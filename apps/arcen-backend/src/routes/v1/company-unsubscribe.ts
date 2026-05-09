/**
 * POST /api/v1/companies/unsubscribe
 *
 * Cancel the authenticated company's subscription (switches to free plan).
 * Auth: Bearer <embed_access_token>
 */
import type { Context } from "hono";
import { db } from "../../db.js";
import { deliverWebhook } from "../../lib/webhooks/deliver-webhook.js";
import { createPublicClient, http, isAddress } from "viem";
import {
  ERC7579AutopayModuleABI,
  getChain,
  getContractAddresses,
} from "@arcenpay/internal-core";
import {
  extractEmbedAccessToken,
  resolveEmbedAccessToken,
} from "../../lib/entitlements/embed-access-token.js";
import { toPrismaJson } from "../../utils/prisma-json.js";
import { upsertSubscriptionLedgerState } from "../../lib/billing/billing-ledger.js";
import { resolvePublishedFreePlan } from "../../lib/catalog/catalog-billing.js";
import {
  normalizeTxHash,
  verifyAutopayCancellationControl,
} from "../../lib/payments/onchain-payment-verification.js";
import { SELF_SERVE_CANCELLATION_ENABLED } from "../../lib/platform/launch-flags.js";
import { DEFAULT_CHAIN_ID } from "../../lib/platform/default-chain.js";
import { getRpcUrl } from "../../config.js";
import { corsHeaders } from "../../middleware/cors.js";

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

export async function OPTIONS(c: Context) {
  return c.json(null, 204 as any, corsHeaders(c.req.header("origin")));
}

export async function POST(c: Context) {
  const origin = c.req.header("origin");

  if (!SELF_SERVE_CANCELLATION_ENABLED) {
    return c.json(
      {
        error:
          "Self-service cancellation is disabled for this launch. Contact support to cancel or downgrade your subscription.",
      },
      403,
      corsHeaders(origin),
    );
  }

  const token = extractEmbedAccessToken({ get: (name: string) => c.req.header(name) });
  if (!token)
    return c.json(
      { error: "Access token required" },
      401,
      corsHeaders(origin),
    );

  if (!process.env.ACCESS_TOKEN_SECRET)
    return c.json(
      { error: "Server configuration error" },
      500,
      corsHeaders(origin),
    );

  const decoded = await resolveEmbedAccessToken(token);
  if (!decoded?.teamId)
    return c.json(
      { error: "Invalid token" },
      401,
      corsHeaders(origin),
    );

  const { teamId, companyId } = decoded;
  if (!companyId)
    return c.json(
      { error: "No company" },
      400,
      corsHeaders(origin),
    );

  let body: {
    txHash?: string;
    autopayControlTxHash?: string;
  } = {};
  try {
    body = (await c.req.json()) as typeof body;
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
    return c.json(
      { error: "Company not found" },
      404,
      corsHeaders(origin),
    );
  }

  if (!freePlan) {
    return c.json(
      {
        error:
          "No published fallback plan is available. Publish a free plan before allowing self-service cancellation.",
      },
      409,
      corsHeaders(origin),
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
      return c.json(
        {
          error:
            "The current billing period end is required before cancellation can be scheduled.",
        },
        409,
        corsHeaders(origin),
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
        return c.json(
          {
            error:
              "The company must have a linked payment account before an on-chain cancellation can be scheduled.",
          },
          409,
          corsHeaders(origin),
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
              return c.json(
                { error: verification.error },
              verification.status as any,
              corsHeaders(origin),
            );
          } else {
            return c.json(
              { error: verification.error },
              verification.status,
              corsHeaders(origin),
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
          return c.json(
            {
              error:
                "Scheduled paid subscription cancellation requires a confirmed AutopayModule.pauseAccount or onUninstall transaction hash, unless autopay is already paused or revoked.",
            },
            400,
            corsHeaders(origin),
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

    return c.json(
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
      pendingVerification ? 202 : 200,
      corsHeaders(origin),
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

    return c.json(
      {
        data: {
          success: true,
          scheduled: false,
          mode: "already_free",
          planId: freePlan.id,
        },
      },
      200,
      corsHeaders(origin),
    );
  }

  return c.json(
    {
      error:
        "Cancellation state is inconsistent. Sync the on-chain subscription before retrying.",
    },
    409,
    corsHeaders(origin),
  );
}
