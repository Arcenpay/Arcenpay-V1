/**
 * POST /api/v1/companies/unsubscribe
 *
 * Cancel the authenticated company's subscription (switches to free plan).
 * Auth: Bearer <embed_access_token>
 */
import type { Context } from "hono";
import { db } from "../../db.js";
import { deliverWebhook } from "../../lib/webhooks/deliver-webhook.js";
import {
  extractEmbedAccessToken,
  resolveEmbedAccessToken,
} from "../../lib/entitlements/embed-access-token.js";
import { toPrismaJson } from "../../utils/prisma-json.js";
import { upsertSubscriptionLedgerState } from "../../lib/billing/billing-ledger.js";
import {
  createSubscriptionChangeRequest,
  findSimilarOpenSubscriptionChangeRequest,
  stripLegacySubscriptionLifecycleTraits,
} from "../../lib/billing/subscription-change-requests.js";
import { resolvePublishedFreePlan } from "../../lib/catalog/catalog-billing.js";
import {
  isEmailDeliveryConfigured,
  sendSubscriptionPlanChangeEmail,
} from "../../lib/billing/email.js";
import { findScopedSubscriberEmail } from "../../lib/billing/subscriber-emails.js";
import { readAutopayAccountState } from "../../lib/payments/autopay-state.js";
import {
  normalizeTxHash,
  verifyAutopayCancellationControl,
} from "../../lib/payments/onchain-payment-verification.js";
import { SELF_SERVE_CANCELLATION_ENABLED } from "../../lib/platform/launch-flags.js";
import { DEFAULT_CHAIN_ID } from "../../lib/platform/default-chain.js";
import { corsHeaders } from "../../middleware/cors.js";

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
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
  if (
    decoded.platformBilling &&
    decoded.teamRole !== "OWNER" &&
    decoded.teamRole !== "ADMIN" &&
    decoded.teamRole !== "FINANCE"
  ) {
    return c.json(
      { error: "Only workspace billing administrators can change the platform subscription" },
      403,
      corsHeaders(origin),
    );
  }

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
        name: true,
        email: true,
        environmentId: true,
        activePlanId: true,
        traits: true,
        walletAddress: true,
        subscriptionState: {
          select: {
            id: true,
            environmentId: true,
            walletAddress: true,
            currentPeriodEnd: true,
            onChainPlanId: true,
            onChainTokenId: true,
            chainId: true,
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
        // Use the chain recorded in SubscriptionState; fall back to DEFAULT_CHAIN_ID for legacy rows.
        const subChainId = company.subscriptionState?.chainId ?? DEFAULT_CHAIN_ID;
        const verification = await verifyAutopayCancellationControl({
          paymentAccount: companyPaymentAccount,
          txHash: normalizedAutopayTxHash,
          chainId: subChainId,
        });
        if (!verification.ok) {
          if (verification.status === 425) {
            const state = await readAutopayAccountState(
              companyPaymentAccount,
              subChainId,
            );
            if (!state || state === "ACTIVE") {
              return c.json(
                { error: verification.error },
                verification.status as any,
                corsHeaders(origin),
              );
            }

            pendingVerification = true;
            autopayControl = {
              control: state,
              txHash: normalizedAutopayTxHash,
            };
          } else {
            return c.json(
              { error: verification.error },
              verification.status as any,
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
        const subChainId = company.subscriptionState?.chainId ?? DEFAULT_CHAIN_ID;
        const state = await readAutopayAccountState(
          companyPaymentAccount,
          subChainId,
        );
        if (!state || state === "ACTIVE") {
          return c.json(
            {
              error:
                "Scheduled paid subscription cancellation requires a confirmed AutopayModule.pauseAccount or onUninstall transaction hash, unless autopay is already paused or revoked.",
            },
            400,
            corsHeaders(origin),
          );
        }
        autopayControl = { control: state };
      }
    }

    const existingRequest = await findSimilarOpenSubscriptionChangeRequest({
      teamId,
      companyId,
      changeType: "cancellation",
      targetPlanId: freePlan.id,
    });

    const transition = {
      mode: "cancel_at_period_end",
      changeType: "cancellation",
      stage: pendingVerification ? "pending_verification" : "requested",
      targetPlanId: freePlan.id,
      targetPlanName: freePlan.name,
      previousPlanId: company.activePlanId,
      requestedAt: new Date().toISOString(),
      effectiveAt: effectiveAt.toISOString(),
      source: "self_service",
    };

    const now = new Date();
    const changeRequest = await db.$transaction(async (tx) => {
      const nextRequest = existingRequest
        ? await tx.subscriptionChangeRequest.update({
            where: { id: existingRequest.id },
            data: {
              stage: pendingVerification
                ? "PENDING_VERIFICATION"
                : "REQUESTED",
              effectiveAt,
              targetPlanId: freePlan.id,
              autopayControlTxHash: normalizedAutopayTxHash ?? null,
              pendingVerification,
              failureReason: null,
              metadata: toPrismaJson({
                ...transition,
                autopayControl: autopayControl
                  ? {
                      control: autopayControl.control,
                      txHash: autopayControl.txHash ?? null,
                    }
                  : null,
              }),
            },
          })
        : await createSubscriptionChangeRequest(
            {
              teamId,
              environmentId:
                company.subscriptionState?.environmentId ??
                company.environmentId ??
                null,
              companyId,
              subscriptionStateId: company.subscriptionState?.id ?? null,
              changeType: "cancellation",
              stage: pendingVerification ? "pending_verification" : "requested",
              previousPlanId: company.activePlanId ?? null,
              targetPlanId: freePlan.id,
              requestedAt: now,
              effectiveAt,
              autopayControlTxHash: normalizedAutopayTxHash ?? null,
              pendingVerification,
              metadata: {
                ...transition,
                autopayControl: autopayControl
                  ? {
                      control: autopayControl.control,
                      txHash: autopayControl.txHash ?? null,
                    }
                  : null,
              },
            },
            tx,
          );

      await tx.arcenCompany.update({
        where: { id: companyId },
        data: {
          traits: toPrismaJson(
            stripLegacySubscriptionLifecycleTraits(currentTraits),
          ),
        },
      });

      await upsertSubscriptionLedgerState(
        {
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
          lastEventAt: now,
          lastSourceTxHash: normalizedAutopayTxHash,
          metadata: {
            source: "self_service",
            transitionId: nextRequest.id,
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
        },
        tx,
      );

      return nextRequest;
    });

    deliverWebhook(teamId, "company.plan.changed", {
      companyId,
      environmentId:
        company.subscriptionState?.environmentId ?? company.environmentId ?? null,
      transitionId: changeRequest.id,
      changeType: "cancellation",
      stage: pendingVerification ? "pending_verification" : "requested",
      previousPlanId: company.activePlanId,
      targetPlanId: freePlan.id,
      planId: company.activePlanId,
      planName: currentPlan?.name ?? null,
      fallbackPlanId: freePlan.id,
      mode: pendingVerification
        ? "cancel_at_period_end_pending_verification"
        : "cancel_at_period_end",
      scheduled: true,
        effectiveAt: effectiveAt.toISOString(),
        autopayControlTxHash: normalizedAutopayTxHash,
        autopayControl: autopayControl?.control ?? null,
        pendingVerification,
      }).catch(() => {});

    const cancellationEmail =
      company.email ??
      (
        await findScopedSubscriberEmail({
          teamId,
          environmentId:
            company.subscriptionState?.environmentId ??
            company.environmentId ??
            null,
          walletAddress: companyPaymentAccount,
        })
      )?.email ??
      null;

    if (cancellationEmail && isEmailDeliveryConfigured()) {
      await sendSubscriptionPlanChangeEmail({
        to: cancellationEmail,
        customerName: company.name,
        changeKind: "cancellation_scheduled",
        currentPlanName: currentPlan?.name ?? null,
        targetPlanName: freePlan.name,
        effectiveAt: effectiveAt.toISOString(),
      }).catch((err) => {
        console.warn(
          "[company-unsubscribe] Failed to send scheduled cancellation email:",
          err,
        );
      });
    }

    return c.json(
      {
        data: {
          success: true,
          transitionId: changeRequest.id,
          changeType: "cancellation",
          stage: pendingVerification ? "pending_verification" : "requested",
          scheduled: true,
          mode: "cancel_at_period_end",
          planId: company.activePlanId,
          fallbackPlanId: freePlan.id,
          effectiveAt: effectiveAt.toISOString(),
          autopayControlTxHash: normalizedAutopayTxHash,
          autopayControl: autopayControl?.control ?? null,
          pendingVerification,
          pendingRecovery: false,
        },
      },
      pendingVerification ? 202 : 200,
      corsHeaders(origin),
    );
  }

  if (!company.activePlanId || company.activePlanId === freePlan.id) {
    const nextTraits = stripLegacySubscriptionLifecycleTraits(currentTraits);
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
          changeType: "cancellation",
          stage: "applied",
          scheduled: false,
          mode: "already_free",
          planId: freePlan.id,
          pendingVerification: false,
          pendingRecovery: false,
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
