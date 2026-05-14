/**
 * POST /api/v1/companies/resume
 *
 * Resume a scheduled cancellation on the authenticated company's subscription.
 * Auth: Bearer <embed_access_token>
 */
import type { Context } from "hono";
import { db } from "../../db.js";
import { deliverWebhook } from "../../lib/webhooks/deliver-webhook.js";
import {
  extractEmbedAccessToken,
  resolveEmbedAccessToken,
} from "../../lib/entitlements/embed-access-token.js";
import {
  createSubscriptionChangeRequest,
  getLatestSubscriptionChangeRequest,
  updateSubscriptionChangeRequestStage,
} from "../../lib/billing/subscription-change-requests.js";
import { readAutopayAccountState } from "../../lib/payments/autopay-state.js";
import { upsertSubscriptionLedgerState } from "../../lib/billing/billing-ledger.js";
import { SELF_SERVE_PLAN_CHANGES_ENABLED } from "../../lib/platform/launch-flags.js";
import { DEFAULT_CHAIN_ID } from "../../lib/platform/default-chain.js";
import { corsHeaders } from "../../middleware/cors.js";
import { toPrismaJson } from "../../utils/prisma-json.js";

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export async function OPTIONS(c: Context) {
  return c.json(null, 204 as any, corsHeaders(c.req.header("origin")));
}

export async function POST(c: Context) {
  const origin = c.req.header("origin");

  if (!SELF_SERVE_PLAN_CHANGES_ENABLED) {
    return c.json(
      {
        error:
          "Self-service subscription resume is disabled for this launch. Contact support to continue your subscription.",
      },
      403,
      corsHeaders(origin),
    );
  }

  const token = extractEmbedAccessToken({
    get: (name: string) => c.req.header(name),
  });
  if (!token) {
    return c.json({ error: "Access token required" }, 401, corsHeaders(origin));
  }

  if (!process.env.ACCESS_TOKEN_SECRET) {
    return c.json(
      { error: "Server configuration error" },
      500,
      corsHeaders(origin),
    );
  }

  const decoded = await resolveEmbedAccessToken(token);
  if (!decoded?.teamId || !decoded.companyId) {
    return c.json({ error: "Invalid token" }, 401, corsHeaders(origin));
  }

  const { teamId, companyId } = decoded;
  const company = await db.arcenCompany.findUnique({
    where: { id: companyId },
    select: {
      id: true,
      teamId: true,
      environmentId: true,
      activePlanId: true,
      walletAddress: true,
      traits: true,
      subscriptionState: {
        select: {
          id: true,
          environmentId: true,
          walletAddress: true,
          onChainPlanId: true,
          onChainTokenId: true,
          currentPeriodEnd: true,
          currentPeriodStart: true,
          chainId: true,
          metadata: true,
        },
      },
    },
  });

  if (!company) {
    return c.json({ error: "Company not found" }, 404, corsHeaders(origin));
  }

  const scheduledCancellation = await getLatestSubscriptionChangeRequest({
    teamId,
    companyId,
  });

  if (
    !scheduledCancellation ||
    scheduledCancellation.changeType !== "cancellation" ||
    (scheduledCancellation.stage !== "requested" &&
      scheduledCancellation.stage !== "pending_verification" &&
      scheduledCancellation.stage !== "pending_recovery")
  ) {
    return c.json(
      {
        error:
          "This company does not have a scheduled cancellation that can be resumed.",
      },
      409,
      corsHeaders(origin),
    );
  }

  const paymentAccount =
    company.subscriptionState?.walletAddress ?? company.walletAddress ?? null;
  const isOnChainSubscription = Boolean(company.subscriptionState?.onChainPlanId);

  const currentPeriodEnd = company.subscriptionState?.currentPeriodEnd ?? null;
  if (currentPeriodEnd && currentPeriodEnd <= new Date()) {
    return c.json(
      {
        error:
          "The current billing period has already ended. The subscription may have been cancelled. Start a new subscription through checkout.",
      },
      409,
      corsHeaders(origin),
    );
  }

  if (isOnChainSubscription) {
    if (!paymentAccount) {
      return c.json(
        {
          error:
            "The company must have a linked payment account before renewals can be resumed.",
        },
        409,
        corsHeaders(origin),
      );
    }

    const chainId = company.subscriptionState?.chainId ?? DEFAULT_CHAIN_ID;
    const autopayState = await readAutopayAccountState(paymentAccount, chainId);
    if (autopayState !== "ACTIVE") {
      return c.json(
        {
          error:
            "Autopay is not active for this payment account yet. Re-enable renewals on-chain before resuming the subscription.",
        },
        409,
        corsHeaders(origin),
      );
    }
  }

  const currentTraits = asRecord(company.traits);
  const nextTraits = { ...currentTraits };
  delete nextTraits.subscriptionTransition;
  delete nextTraits.pendingSubscriptionChangeRequestId;

  const now = new Date();

  await updateSubscriptionChangeRequestStage({
    requestId: scheduledCancellation.id,
    stage: "reverted",
    appliedAt: now,
    metadata: {
      resumedAt: now.toISOString(),
    },
  });

  const resumeRequest = await createSubscriptionChangeRequest({
    teamId,
    environmentId:
      company.subscriptionState?.environmentId ?? company.environmentId ?? null,
    companyId,
    subscriptionStateId: company.subscriptionState?.id ?? null,
    changeType: "resume",
    stage: "applied",
    source: "self_service",
    previousPlanId: company.activePlanId ?? null,
    targetPlanId: company.activePlanId ?? null,
    requestedAt: now,
    effectiveAt: company.subscriptionState?.currentPeriodEnd ?? null,
    appliedAt: now,
    metadata: {
      mode: "resume_applied",
      resumedCancellationRequestId: scheduledCancellation.id,
    },
  });

  await db.arcenCompany.update({
    where: { id: companyId },
    data: {
      traits: toPrismaJson(nextTraits),
    },
  });

  await upsertSubscriptionLedgerState({
    teamId,
    environmentId:
      company.subscriptionState?.environmentId ?? company.environmentId ?? null,
    companyId,
    walletAddress: paymentAccount,
    chainId: company.subscriptionState?.chainId ?? null,
    status: "ACTIVE",
    catalogPlanId: company.activePlanId ?? null,
    onChainPlanId: company.subscriptionState?.onChainPlanId ?? null,
    onChainTokenId: company.subscriptionState?.onChainTokenId ?? null,
    currentPeriodStart: company.subscriptionState?.currentPeriodStart ?? undefined,
    currentPeriodEnd: company.subscriptionState?.currentPeriodEnd ?? undefined,
    cancelAtPeriodEnd: false,
    cancelledAt: null,
    pastDueAt: null,
    graceEndsAt: null,
    lastEvent: "subscription.resume_applied",
    lastEventAt: now,
    metadata: {
      ...asRecord(company.subscriptionState?.metadata),
      source: "self_service",
      resumedCancellationRequestId: scheduledCancellation.id,
      resumeRequestId: resumeRequest.id,
    },
  });

  deliverWebhook(teamId, "company.plan.changed", {
    companyId,
    environmentId:
      company.subscriptionState?.environmentId ?? company.environmentId ?? null,
    transitionId: resumeRequest.id,
    changeType: "resume",
    stage: "applied",
    previousPlanId: company.activePlanId ?? null,
    targetPlanId: company.activePlanId ?? null,
    planId: company.activePlanId ?? null,
    mode: "resume_applied",
    scheduled: false,
    effectiveAt:
      company.subscriptionState?.currentPeriodEnd?.toISOString() ?? null,
    resumedCancellationRequestId: scheduledCancellation.id,
  }).catch(() => {});

  return c.json(
    {
      data: {
        success: true,
        transitionId: resumeRequest.id,
        changeType: "resume",
        stage: "applied",
        scheduled: false,
        mode: "resume_applied",
        planId: company.activePlanId ?? null,
        effectiveAt:
          company.subscriptionState?.currentPeriodEnd?.toISOString() ?? null,
        pendingVerification: false,
        pendingRecovery: false,
      },
    },
    200,
    corsHeaders(origin),
  );
}
