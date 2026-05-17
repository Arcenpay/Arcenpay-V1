/**
 * POST /api/v1/companies/plan
 *
 * Switch the authenticated company's active plan.
 * Auth: Bearer <embed_access_token>
 * Body: { planId: string, customerName?: string, customerEmail?: string }
 */
import type { Context } from "hono";
import { db } from "../../db.js";
import {
  createPublicClient,
  encodeFunctionData,
  http,
  isAddress,
} from "viem";
import { deliverWebhook } from "../../lib/webhooks/deliver-webhook.js";
import { resolveEntitlementResults } from "../../lib/entitlements/entitlements.js";
import {
  extractEmbedAccessToken,
  resolveEmbedAccessToken,
} from "../../lib/entitlements/embed-access-token.js";
import { toPrismaJson } from "../../utils/prisma-json.js";
import { allocateInvoiceNumber } from "../../lib/billing/invoices.js";
import {
  incrementCouponRedemption,
  normalizeBillingPeriod,
  normalizeCouponCode,
  resolvePlanAmountMicros,
  resolveCouponQuote,
} from "../../lib/catalog/catalog-billing.js";
import {
  recordSuccessfulPayment,
  upsertSubscriptionLedgerState,
} from "../../lib/billing/billing-ledger.js";
import { recordBillingAdjustment } from "../../lib/billing/billing-adjustments.js";
import { sendPaidInvoiceReceipt } from "../../lib/billing/invoice-notifications.js";
import { computeProrationQuote } from "../../lib/billing/billing-proration.js";
import {
  createSubscriptionChangeRequest,
  findSimilarOpenSubscriptionChangeRequest,
  getLatestSubscriptionChangeRequest,
  stripLegacySubscriptionLifecycleTraits,
} from "../../lib/billing/subscription-change-requests.js";
import {
  normalizeTxHash,
  verifyAutopayPlanChange,
  verifyDirectErc20Transfer,
  verifySubscriptionRegistryPlanChange,
} from "../../lib/payments/onchain-payment-verification.js";
import { SELF_SERVE_PLAN_CHANGES_ENABLED } from "../../lib/platform/launch-flags.js";
import {
  getChain,
  getContractAddresses,
  SubscriptionRegistryABI,
} from "@arcenpay/internal-core";
import { getRpcUrl } from "../../config.js";
import { DEFAULT_CHAIN_ID } from "../../lib/platform/default-chain.js";

type PlanRouteDb = Pick<
  typeof db,
  "team" | "invoice" | "arcenCompany" | "subscriptionState" | "payment" | "paymentAttempt" | "billingAdjustment"
>;

type SubscriptionTransition = {
  mode:
    | "period_end_downgrade"
    | "cancel_at_period_end"
    | "next_renewal_on_chain"
    | "immediate_prorated_upgrade";
  changeType?: "upgrade" | "downgrade" | "cancellation" | "resume" | "billing_period_change";
  stage?: "requested" | "pending_verification" | "pending_recovery" | "applied" | "failed" | "reverted";
  transitionId?: string | null;
  targetPlanId: string | null;
  targetPlanName: string | null;
  targetBillingPeriod: "monthly" | "annual";
  previousPlanId: string | null;
  previousBillingPeriod: "monthly" | "annual";
  requestedAt: string;
  effectiveAt: string | null;
  source: "self_service";
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readStoredBillingPeriod(
  source: unknown,
): "monthly" | "annual" | null {
  const billingPeriod = asRecord(source).billingPeriod;
  return normalizeBillingPeriod(
    typeof billingPeriod === "string" ? billingPeriod : undefined,
  );
}

function deriveBillingPeriodFromPlan(
  plan: { billingInterval?: number | null } | null | undefined,
): "monthly" | "annual" {
  return typeof plan?.billingInterval === "number" &&
    plan.billingInterval >= 31_536_000
    ? "annual"
    : "monthly";
}

function isOpenLifecycleStage(
  stage:
    | "requested"
    | "pending_verification"
    | "pending_recovery"
    | "applied"
    | "failed"
    | "reverted"
    | null
    | undefined,
): boolean {
  return (
    stage === "requested" ||
    stage === "pending_verification" ||
    stage === "pending_recovery"
  );
}

function readLifecycleResponseMode(input: {
  mode?: string | null;
  changeType?: "upgrade" | "downgrade" | "cancellation" | "resume" | "billing_period_change" | null;
}): string {
  if (typeof input.mode === "string" && input.mode.trim()) {
    return input.mode.trim();
  }

  switch (input.changeType) {
    case "upgrade":
      return "immediate_prorated_upgrade";
    case "downgrade":
      return "period_end_downgrade";
    case "billing_period_change":
      return "next_renewal_on_chain";
    case "resume":
      return "resume_requested";
    case "cancellation":
      return "cancel_at_period_end";
    default:
      return "subscription_change";
  }
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

import { corsHeaders } from "../../middleware/cors.js";

function createChainClients(chainId?: number) {
  const resolvedChainId = chainId ?? DEFAULT_CHAIN_ID;
  const chain = getChain(resolvedChainId);
  return {
    chain,
    publicClient: createPublicClient({
      chain,
      transport: http(getRpcUrl(resolvedChainId)),
    }),
    contracts: getContractAddresses(resolvedChainId),
  };
}

function microsToAmount(value: bigint | number): number {
  return Number(value) / 1_000_000;
}

function microsToAmountString(value: bigint | number): string {
  if (typeof value === "number") return value.toFixed(6);

  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const whole = absolute / 1_000_000n;
  const fraction = (absolute % 1_000_000n).toString().padStart(6, "0");
  return `${sign}${whole.toString()}.${fraction}`;
}

function buildLifecycleResponse(input: {
  success?: boolean;
  transitionId?: string | null;
  changeType: "upgrade" | "downgrade" | "cancellation" | "resume" | "billing_period_change";
  stage:
    | "requested"
    | "pending_verification"
    | "pending_recovery"
    | "applied"
    | "failed"
    | "reverted";
  scheduled: boolean;
  mode: string;
  effectiveAt?: string | null;
  pendingVerification?: boolean;
  pendingRecovery?: boolean;
  data?: Record<string, unknown>;
}) {
  return {
    success: input.success ?? true,
    transitionId: input.transitionId ?? null,
    changeType: input.changeType,
    stage: input.stage,
    scheduled: input.scheduled,
    mode: input.mode,
    effectiveAt: input.effectiveAt ?? null,
    pendingVerification: input.pendingVerification ?? false,
    pendingRecovery: input.pendingRecovery ?? false,
    ...(input.data ?? {}),
  };
}

function createProrationSummary(params: {
  currentPlanName: string;
  targetPlanName: string;
  currentPlanAmountMicros: bigint;
  targetPlanAmountMicros: bigint;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  effectiveAt: Date;
}) {
  const quote = computeProrationQuote({
    currentAmountMicros: params.currentPlanAmountMicros,
    targetAmountMicros: params.targetPlanAmountMicros,
    currentPeriodStart: params.currentPeriodStart,
    currentPeriodEnd: params.currentPeriodEnd,
    effectiveAt: params.effectiveAt,
  });
  const amountDueMicros = quote.deltaMicros > 0n ? quote.deltaMicros : 0n;
  const creditMicros = quote.deltaMicros < 0n ? -quote.deltaMicros : 0n;
  const unusedCreditMicros = -quote.currentRemainingMicros;

  return {
    quote,
    amountDueMicros,
    creditMicros,
    response: {
      currency: "USDC",
      currentPlanName: params.currentPlanName,
      targetPlanName: params.targetPlanName,
      currentPeriodStart: params.currentPeriodStart.toISOString(),
      currentPeriodEnd: params.currentPeriodEnd.toISOString(),
      effectiveAt: params.effectiveAt.toISOString(),
      totalPeriodSeconds: quote.totalPeriodSeconds,
      remainingSeconds: quote.remainingSeconds,
      remainingRatio: quote.remainingRatio,
      newPlanRemainingCharge: microsToAmountString(
        quote.targetRemainingMicros,
      ),
      unusedOldPlanCredit: microsToAmountString(unusedCreditMicros),
      amountDue: microsToAmountString(amountDueMicros),
      amountPaid: microsToAmountString(amountDueMicros),
      amountRemaining: creditMicros > 0n
        ? microsToAmountString(creditMicros)
        : "0.000000",
      hasCreditBalance: creditMicros > 0n,
    },
  };
}

async function createProrationInvoice(input: {
  teamId: string;
  companyId: string;
  customerName?: string | null;
  customerEmail?: string | null;
  customerWallet?: string | null;
  planId: string;
  currentPlanName: string;
  targetPlanName: string;
  targetRemainingMicros: bigint;
  currentRemainingMicros: bigint;
  amountDueMicros: bigint;
  issuedAt: Date;
  metadata?: Record<string, unknown>;
}, client: Pick<PlanRouteDb, "team" | "invoice"> = db) {
  const team = await client.team.findUnique({
    where: { id: input.teamId },
    select: { slug: true, invoicePrefix: true, environmentMode: true },
  });
  if (!team) throw new Error("Team not found");

  const prefix = team.invoicePrefix || `INV-${team.slug.toUpperCase()}`;
  const number = await allocateInvoiceNumber(input.teamId, prefix, input.issuedAt);
  const targetCharge = microsToAmountString(input.targetRemainingMicros);
  const unusedCredit = microsToAmountString(-input.currentRemainingMicros);
  const amountDue = microsToAmountString(input.amountDueMicros);

  return client.invoice.create({
    data: {
      teamId: input.teamId,
      environmentMode: team.environmentMode,
      status: "ISSUED",
      number,
      currency: "USDC",
      customerEmail: input.customerEmail ?? null,
      customerWallet: input.customerWallet?.toLowerCase() ?? null,
      subtotal: amountDue,
      taxTotal: "0.000000",
      total: amountDue,
      amountPaid: "0.000000",
      amountCredited: "0.000000",
      amountOutstanding: amountDue,
      issuedAt: input.issuedAt,
      planId: input.planId,
      companyId: input.companyId,
      metadata: toPrismaJson({
        ...(input.metadata ?? {}),
        ...(input.customerName ? { customerName: input.customerName } : {}),
      }),
      lineItems: {
        create: [
          {
            description: `Remaining time on ${input.targetPlanName}`,
            quantity: 1,
            unitAmount: targetCharge,
            taxRate: "0.0000",
            lineSubtotal: targetCharge,
            lineTax: "0.000000",
            lineTotal: targetCharge,
          },
          {
            description: `Unused time on ${input.currentPlanName}`,
            quantity: 1,
            unitAmount: unusedCredit,
            taxRate: "0.0000",
            lineSubtotal: unusedCredit,
            lineTax: "0.000000",
            lineTotal: unusedCredit,
          },
        ],
      },
    },
  });
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

export async function OPTIONS(c: Context) {
  return c.json(null, 204 as any, corsHeaders(c.req.header("origin")));
}

type CompanyPlanRequestBody = {
  planId?: string;
  billingPeriod?: string;
  txHash?: string;
  planChangeTxHash?: string;
  autopayConfigTxHash?: string;
  accessChangeTxHash?: string;
  paymentTxHash?: string;
  previewOnly?: boolean;
  scheduleAtPeriodEnd?: boolean;
  couponCode?: string;
  customerName?: string;
  customerEmail?: string;
};

export async function handleCompanyPlanRequest(
  c: Context,
  bodyOverride?: Partial<CompanyPlanRequestBody>,
) {
  const origin = c.req.header("origin");

  if (!SELF_SERVE_PLAN_CHANGES_ENABLED) {
    return c.json(
      {
        error:
          "Self-service plan changes are disabled for this launch. Start a new subscription through checkout or contact support for plan changes.",
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
      { error: "Invalid or expired token" },
      401,
      corsHeaders(origin),
    );

  const { teamId, companyId } = decoded;
  if (!companyId)
    return c.json(
      { error: "No company associated with this token" },
      400,
      corsHeaders(origin),
    );

  let body: CompanyPlanRequestBody;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { error: "Invalid JSON" },
      400,
      corsHeaders(origin),
    );
  }
  body = {
    ...body,
    ...(bodyOverride ?? {}),
  };

  const {
    planId,
    billingPeriod,
    txHash,
    planChangeTxHash,
    autopayConfigTxHash,
    accessChangeTxHash,
    paymentTxHash,
    previewOnly,
    scheduleAtPeriodEnd,
    couponCode,
    customerName,
    customerEmail,
  } = body;
  if (!planId)
    return c.json(
      { error: "planId is required" },
      400,
      corsHeaders(origin),
    );

  // Verify the plan belongs to this team and is published
  const plan = await db.catalogPlan.findFirst({
    where: { id: planId, teamId, status: "PUBLISHED", active: true },
    select: {
      id: true,
      name: true,
      price: true,
      annualPrice: true,
      billingInterval: true,
      acceptedToken: true,
      onChainPlanId: true,
      environmentId: true,
      metadata: true,
    },
  });
  if (!plan)
    return c.json(
      { error: "Plan not found or not published" },
      404,
      corsHeaders(origin),
    );

  const company = await db.arcenCompany.findUnique({
    where: { id: companyId },
    select: {
      id: true,
      environmentId: true,
      activePlanId: true,
      name: true,
      traits: true,
      walletAddress: true,
      email: true,
      subscriptionState: {
        select: {
          id: true,
          chainId: true,
          walletAddress: true,
          currentPeriodStart: true,
          currentPeriodEnd: true,
          onChainPlanId: true,
          onChainTokenId: true,
          metadata: true,
          environmentId: true,
        },
      },
    },
  });
  if (!company) {
    return c.json(
      { error: "Company not found" },
      404,
      corsHeaders(origin),
    );
  }

  const companyPaymentAccount =
    company.subscriptionState?.walletAddress ?? company.walletAddress ?? null;

  const normalizedCustomerEmail =
    typeof customerEmail === "string" ? customerEmail.trim() : "";
  const normalizedCustomerName =
    typeof customerName === "string"
      ? customerName.trim().replace(/\s+/g, " ")
      : "";
  const hasCustomerName = normalizedCustomerName.length > 0;
  const hasCustomerEmail =
    normalizedCustomerEmail.length > 0 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedCustomerEmail);

  if (normalizedCustomerEmail && !hasCustomerEmail) {
    return c.json(
      { error: "customerEmail must be a valid email address" },
      400,
      corsHeaders(origin),
    );
  }

  const companyUpdates: { email?: string; name?: string } = {};
  if (hasCustomerEmail && company.email !== normalizedCustomerEmail) {
    companyUpdates.email = normalizedCustomerEmail;
  }
  if (hasCustomerName && company.name !== normalizedCustomerName) {
    companyUpdates.name = normalizedCustomerName;
  }

  if (companyUpdates.email || companyUpdates.name) {
    await db.arcenCompany.update({
      where: { id: company.id },
      data: companyUpdates,
    });

    if (companyPaymentAccount && companyUpdates.email) {
      await db.subscriberEmail.upsert({
        where: { walletAddress: companyPaymentAccount },
        update: {
          email: companyUpdates.email,
          planId: company.activePlanId ?? planId,
        },
        create: {
          walletAddress: companyPaymentAccount,
          email: companyUpdates.email,
          planId: company.activePlanId ?? planId,
        },
      });
    }
  }

  const resolvedCompanyName = companyUpdates.name ?? company.name ?? null;
  const resolvedCompanyEmail = companyUpdates.email ?? company.email ?? null;

  const currentPlan = company.activePlanId
    ? await db.catalogPlan.findFirst({
        where: { id: company.activePlanId, teamId },
        select: {
          id: true,
          name: true,
          price: true,
          annualPrice: true,
          billingInterval: true,
          onChainPlanId: true,
          environmentId: true,
        },
      })
    : null;

  const companyEnvironmentId =
    company.subscriptionState?.environmentId ?? currentPlan?.environmentId ?? null;
  const catalogConfig = await db.catalogConfig.findFirst({
    where: {
      teamId,
      ...(companyEnvironmentId
        ? { environmentId: companyEnvironmentId }
        : plan.environmentId
          ? { environmentId: plan.environmentId }
          : {}),
    },
    orderBy: { updatedAt: "desc" },
    select: {
      downgradeImmediately: true,
      preventDowngradeOverLimit: true,
      disallowSelfServiceDowngrade: true,
    },
  });
  if (!plan.environmentId) {
    return c.json(
      {
        error:
          "Legacy plans without workspace environments cannot be used for self-service plan changes.",
      },
      409,
      corsHeaders(origin),
    );
  }

  if (companyEnvironmentId && companyEnvironmentId !== plan.environmentId) {
    return c.json(
      {
        error:
          "This plan belongs to a different workspace environment. Switch to a plan from the company's current environment.",
      },
      409,
      corsHeaders(origin),
    );
  }

  const previousPlanId = company.activePlanId;
  const currentBillingPeriod =
    readStoredBillingPeriod(company.subscriptionState?.metadata) ??
    readStoredBillingPeriod(company.traits) ??
    deriveBillingPeriodFromPlan(currentPlan);
  const normalizedBillingPeriod =
    normalizeBillingPeriod(billingPeriod) ?? currentBillingPeriod;
  const pendingLifecycleRequest = await getLatestSubscriptionChangeRequest({
    teamId,
    companyId,
  });
  const hasScheduledCancellation =
    pendingLifecycleRequest?.changeType === "cancellation" &&
    isOpenLifecycleStage(pendingLifecycleRequest.stage);
  if (
    previousPlanId === plan.id &&
    currentBillingPeriod === normalizedBillingPeriod &&
    !hasScheduledCancellation
  ) {
    return c.json(
      {
        data: {
          ...buildLifecycleResponse({
            changeType: "billing_period_change",
            stage: "applied",
            scheduled: false,
            mode: "no_change",
            data: {
              planId: plan.id,
              planName: plan.name,
            },
          }),
        },
      },
      200,
      corsHeaders(origin),
    );
  }

  const hasMatchingOpenPlanChange =
    pendingLifecycleRequest?.changeType !== "cancellation" &&
    isOpenLifecycleStage(pendingLifecycleRequest?.stage) &&
    pendingLifecycleRequest?.targetPlanId === plan.id &&
    (pendingLifecycleRequest?.targetBillingPeriod ?? normalizedBillingPeriod) ===
      normalizedBillingPeriod;

  if (hasMatchingOpenPlanChange && pendingLifecycleRequest) {
    return c.json(
      {
        data: {
          ...buildLifecycleResponse({
            transitionId: pendingLifecycleRequest.id,
            changeType: pendingLifecycleRequest.changeType ?? "billing_period_change",
            stage: pendingLifecycleRequest.stage ?? "requested",
            scheduled: pendingLifecycleRequest.changeType !== "upgrade",
            mode: readLifecycleResponseMode({
              mode: pendingLifecycleRequest.mode,
              changeType: pendingLifecycleRequest.changeType,
            }),
            effectiveAt: pendingLifecycleRequest.effectiveAt ?? null,
            pendingVerification:
              pendingLifecycleRequest.pendingVerification ?? false,
            pendingRecovery: pendingLifecycleRequest.pendingRecovery ?? false,
            data: {
              planId: plan.id,
              planName: plan.name,
              previousPlanId:
                pendingLifecycleRequest.previousPlanId ?? previousPlanId ?? null,
              previousBillingPeriod:
                pendingLifecycleRequest.previousBillingPeriod ??
                currentBillingPeriod,
              targetBillingPeriod:
                pendingLifecycleRequest.targetBillingPeriod ??
                normalizedBillingPeriod,
              alreadyScheduled: true,
              ...(asRecord(pendingLifecycleRequest.metadata).proration
                ? {
                    proration: asRecord(pendingLifecycleRequest.metadata)
                      .proration,
                  }
                : {}),
            },
          }),
        },
      },
      200,
      corsHeaders(origin),
    );
  }

  const shouldScheduleDowngrade =
    !!currentPlan &&
    resolvePlanAmountMicros(plan, normalizedBillingPeriod) <
      resolvePlanAmountMicros(currentPlan, currentBillingPeriod);
  const currentPlanAmountMicros = currentPlan
    ? resolvePlanAmountMicros(currentPlan, currentBillingPeriod)
    : 0;
  const targetPlanAmountMicros = resolvePlanAmountMicros(
    plan,
    normalizedBillingPeriod,
  );
  const currentPrice = Number(currentPlanAmountMicros) / 1_000_000;
  const targetPrice = Number(targetPlanAmountMicros) / 1_000_000;
  const isDowngrade = !!currentPlan && targetPlanAmountMicros < currentPlanAmountMicros;
  const usesAuthoritativeOnChainPlanChange =
    Boolean(currentPlan?.onChainPlanId) || Boolean(plan.onChainPlanId);

  const quoteResult = await resolveCouponQuote({
    teamId,
    planId: plan.id,
    billingPeriod: normalizedBillingPeriod,
    couponCode,
  });
  if (!quoteResult.ok) {
    return c.json(
      { error: quoteResult.error },
      quoteResult.status,
      corsHeaders(origin),
    );
  }
  const normalizedCouponCode = normalizeCouponCode(couponCode);
  const quotedAmountMicros = quoteResult.quote.finalAmountMicros;

  if ((currentPrice > 0 || targetPrice > 0) && !usesAuthoritativeOnChainPlanChange) {
    return c.json(
      {
        error:
          "Self-service paid plan changes must use the authoritative on-chain subscription flows. Off-chain paid plan changes remain blocked.",
      },
      409,
      corsHeaders(origin),
    );
  }

  if (usesAuthoritativeOnChainPlanChange) {
    const targetPlanNativeBillingPeriod = deriveBillingPeriodFromPlan(plan);
    if (
      normalizedBillingPeriod === "annual" &&
      targetPlanNativeBillingPeriod !== "annual" &&
      !plan.annualPrice
    ) {
      return c.json(
        {
          error:
            "Annual billing is not available because this plan does not have an annual price configured. Publish a dedicated annual on-chain plan variant first, then subscribe to that plan directly.",
        },
        409,
        corsHeaders(origin),
      );
    }

    if (!currentPlan?.onChainPlanId) {
      return c.json(
        {
          error:
            "Upgrading from a free or off-chain plan into an on-chain subscription must use the subscription checkout flow, not the self-serve plan-change endpoint.",
        },
        409,
        corsHeaders(origin),
      );
    }

    if (!plan.onChainPlanId) {
      return c.json(
        {
          error:
            "Moving from an on-chain paid subscription to a free or off-chain plan must use the subscription cancellation flow first so future billing stops authoritatively.",
        },
        409,
        corsHeaders(origin),
      );
    }

    if (normalizedCouponCode) {
      return c.json(
        {
          error:
            "Coupons are not supported for authoritative on-chain plan changes yet because discount state is not carried into the recurring subscription config.",
        },
        409,
        corsHeaders(origin),
      );
    }

  }

  if (isDowngrade && (catalogConfig?.disallowSelfServiceDowngrade ?? false)) {
    return c.json(
      {
        error:
          "Self-service downgrades are disabled for this billing catalog. Contact support.",
      },
      403,
      corsHeaders(origin),
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
            email: resolvedCompanyEmail ?? undefined,
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
        return c.json(
          {
            error:
              "Downgrade blocked because current usage exceeds the selected plan limits.",
            details: overages,
          },
          409,
          corsHeaders(origin),
        );
      }
    }
  }

  const currentTraits = asRecord(company.traits);
  const consumedPaymentTxHashes = readConsumedPaymentTxHashes(currentTraits);

  if (usesAuthoritativeOnChainPlanChange) {
    if (!companyPaymentAccount) {
      return c.json(
        {
          error:
            "The company must have a linked payment account before an on-chain plan change can be verified.",
        },
        409,
        corsHeaders(origin),
      );
    }

    const isUpgrade = targetPlanAmountMicros > currentPlanAmountMicros;
    const currentPeriodStart = company.subscriptionState?.currentPeriodStart;
    const currentPeriodEnd = company.subscriptionState?.currentPeriodEnd;
    const effectiveAt = new Date();

    if (isUpgrade && previewOnly === true) {
      if (
        !currentPeriodStart ||
        !currentPeriodEnd ||
        Number.isNaN(currentPeriodEnd.getTime()) ||
        currentPeriodEnd <= currentPeriodStart
      ) {
        return c.json(
          {
            error:
              "The current billing period is required before an upgrade can be prorated.",
          },
          409,
          corsHeaders(origin),
        );
      }

      const proration = createProrationSummary({
        currentPlanName: currentPlan?.name ?? "Current plan",
        targetPlanName: plan.name,
        currentPlanAmountMicros: BigInt(currentPlanAmountMicros),
        targetPlanAmountMicros: BigInt(targetPlanAmountMicros),
        currentPeriodStart,
        currentPeriodEnd,
        effectiveAt,
      });

      return c.json(
        {
          data: {
            ...buildLifecycleResponse({
              changeType: "upgrade",
              stage: "requested",
              scheduled: false,
              mode: "immediate_prorated_upgrade_preview",
              data: {
                previewOnly: true,
                planId,
                planName: plan.name,
                previousPlanId: previousPlanId ?? null,
                proration: proration.response,
              },
            }),
          },
        },
        200,
        corsHeaders(origin),
      );
    }

    const normalizedAutopayConfigTxHash = normalizeTxHash(
      autopayConfigTxHash ?? planChangeTxHash ?? txHash,
    );
    if (!normalizedAutopayConfigTxHash) {
      return c.json(
        {
          error:
            "Authoritative on-chain plan changes require the confirmed AutopayModule.updateConfig transaction hash.",
        },
        400,
        corsHeaders(origin),
      );
    }

    if (consumedPaymentTxHashes.includes(normalizedAutopayConfigTxHash)) {
      return c.json(
        {
          error:
          "This autopay config transaction hash has already been used for a previous plan change.",
        },
        409,
        corsHeaders(origin),
      );
    }

    const subChainId = company.subscriptionState?.chainId;
    const verification = await verifyAutopayPlanChange({
      paymentAccount: companyPaymentAccount,
      txHash: normalizedAutopayConfigTxHash,
      expectedOnChainPlanId: plan.onChainPlanId!,
      chainId: subChainId,
    });
    if (!verification.ok) {
      if (verification.status === 425) {
        const pendingChangeType = isUpgrade
          ? "upgrade"
          : isDowngrade
            ? "downgrade"
            : "billing_period_change";
        const pendingMode = isUpgrade
          ? "immediate_prorated_upgrade"
          : isDowngrade
            ? "period_end_downgrade"
            : "next_renewal_on_chain";
        const pendingEffectiveAt = isUpgrade
          ? null
          : company.subscriptionState?.currentPeriodEnd ?? null;
        const pendingProration =
          isUpgrade &&
          company.subscriptionState?.currentPeriodStart &&
          company.subscriptionState?.currentPeriodEnd &&
          company.subscriptionState.currentPeriodEnd >
            company.subscriptionState.currentPeriodStart
            ? createProrationSummary({
                currentPlanName: currentPlan?.name ?? "Current plan",
                targetPlanName: plan.name,
                currentPlanAmountMicros: BigInt(currentPlanAmountMicros),
                targetPlanAmountMicros: BigInt(targetPlanAmountMicros),
                currentPeriodStart: company.subscriptionState.currentPeriodStart,
                currentPeriodEnd: company.subscriptionState.currentPeriodEnd,
                effectiveAt: new Date(),
              }).response
            : null;
        const existingRequest = await findSimilarOpenSubscriptionChangeRequest({
          teamId,
          companyId,
          changeType: pendingChangeType,
          targetPlanId: plan.id,
        });
        const transition: SubscriptionTransition = {
          mode: pendingMode,
          changeType: pendingChangeType,
          stage: "pending_verification",
          targetPlanId: plan.id,
          targetPlanName: plan.name,
          targetBillingPeriod: normalizedBillingPeriod,
          previousPlanId: previousPlanId ?? null,
          previousBillingPeriod: currentBillingPeriod,
          requestedAt: new Date().toISOString(),
          effectiveAt: pendingEffectiveAt?.toISOString() ?? null,
          source: "self_service",
        };

        const transitionMetadata = {
          ...transition,
          autopayConfigTxHash: normalizedAutopayConfigTxHash,
          pendingVerification: true,
          requiresOnChainSync: true,
          pendingOnChainPlanId: plan.onChainPlanId,
          proration: pendingProration,
        };

        const now = new Date();
        const changeRequest = await db.$transaction(async (tx) => {
          const nextRequest = existingRequest
            ? await tx.subscriptionChangeRequest.update({
                where: { id: existingRequest.id },
                data: {
                  stage: "PENDING_VERIFICATION",
                  previousPlanId: previousPlanId ?? null,
                  targetPlanId: plan.id,
                  previousBillingPeriod: currentBillingPeriod,
                  targetBillingPeriod: normalizedBillingPeriod,
                  effectiveAt: pendingEffectiveAt,
                  autopayConfigTxHash: normalizedAutopayConfigTxHash,
                  pendingVerification: true,
                  failureReason: null,
                  metadata: toPrismaJson(transitionMetadata),
                },
              })
            : await createSubscriptionChangeRequest(
                {
                  teamId,
                  environmentId:
                    company.subscriptionState?.environmentId ??
                    company.environmentId ??
                    plan.environmentId ??
                    null,
                  companyId,
                  subscriptionStateId: company.subscriptionState?.id ?? null,
                  changeType: pendingChangeType,
                  stage: "pending_verification",
                  source: "self_service",
                  previousPlanId: previousPlanId ?? null,
                  targetPlanId: plan.id,
                  previousBillingPeriod: currentBillingPeriod,
                  targetBillingPeriod: normalizedBillingPeriod,
                  requestedAt: now,
                  effectiveAt: pendingEffectiveAt,
                  autopayConfigTxHash: normalizedAutopayConfigTxHash,
                  pendingVerification: true,
                  metadata: transitionMetadata,
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
              catalogPlanId: currentPlan?.id ?? previousPlanId ?? null,
              onChainPlanId:
                company.subscriptionState?.onChainPlanId ??
                currentPlan?.onChainPlanId ??
                null,
              onChainTokenId: company.subscriptionState?.onChainTokenId ?? null,
              currentPeriodEnd:
                company.subscriptionState?.currentPeriodEnd ?? null,
              pastDueAt: null,
              graceEndsAt: null,
              lastEvent: "subscription.plan_change_pending_verification",
              lastEventAt: now,
              lastSourceTxHash: normalizedAutopayConfigTxHash,
              metadata: {
                source: "self_service",
                transitionId: nextRequest.id,
                billingPeriod: currentBillingPeriod,
                previousBillingPeriod: currentBillingPeriod,
                pendingBillingPeriod: normalizedBillingPeriod,
                pendingCatalogPlanId: plan.id,
                pendingOnChainPlanId: plan.onChainPlanId,
                previousCatalogPlanId: previousPlanId ?? null,
                pendingVerification: true,
              },
            },
            tx,
          );

          return nextRequest;
        });
        transition.transitionId = changeRequest.id;

        deliverWebhook(teamId, "company.plan.changed", {
          companyId,
          environmentId:
            company.subscriptionState?.environmentId ??
            company.environmentId ??
            plan.environmentId ??
            null,
          transitionId: changeRequest.id,
          changeType: pendingChangeType,
          stage: "pending_verification",
          planId,
          planName: plan.name,
          billingPeriod: normalizedBillingPeriod,
          previousPlanId: previousPlanId ?? null,
          targetPlanId: plan.id,
          mode: pendingMode,
          scheduled: !isUpgrade,
          txHash: normalizedAutopayConfigTxHash,
          autopayConfigTxHash: normalizedAutopayConfigTxHash,
          effectiveAt: pendingEffectiveAt?.toISOString() ?? null,
          pendingVerification: true,
          ...(pendingProration ? { proration: pendingProration } : {}),
        }).catch(() => {});

        return c.json(
          {
            data: {
              ...buildLifecycleResponse({
                transitionId: changeRequest.id,
                changeType: pendingChangeType,
                stage: "pending_verification",
                scheduled: !isUpgrade,
                mode: pendingMode,
                effectiveAt: pendingEffectiveAt?.toISOString() ?? null,
                pendingVerification: true,
                data: {
                  planId,
                  planName: plan.name,
                  previousPlanId: previousPlanId ?? null,
                  autopayConfigTxHash: normalizedAutopayConfigTxHash,
                  previousBillingPeriod: currentBillingPeriod,
                  targetBillingPeriod: normalizedBillingPeriod,
                  ...(pendingProration ? { proration: pendingProration } : {}),
                },
              }),
            },
          },
          202,
          corsHeaders(origin),
        );
      }

      return c.json(
        { error: verification.error },
        verification.status as any,
        corsHeaders(origin),
      );
    }

    if (isUpgrade) {
      const periodStart = currentPeriodStart;
      const periodEnd = new Date(verification.currentPeriodEnd);

      if (
        !periodStart ||
        Number.isNaN(periodEnd.getTime()) ||
        periodEnd <= periodStart
      ) {
        return c.json(
          {
            error:
              "The current billing period is required before an upgrade can be prorated.",
          },
          409,
          corsHeaders(origin),
        );
      }

      const proration = createProrationSummary({
        currentPlanName: currentPlan?.name ?? "Current plan",
        targetPlanName: plan.name,
        currentPlanAmountMicros: BigInt(currentPlanAmountMicros),
        targetPlanAmountMicros: BigInt(targetPlanAmountMicros),
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        effectiveAt,
      });

      const normalizedPaymentTxHash = normalizeTxHash(paymentTxHash);
      const normalizedRequestedAccessChangeTxHash = normalizeTxHash(
        body.accessChangeTxHash ?? planChangeTxHash,
      );
      if (proration.amountDueMicros > 0n && !normalizedPaymentTxHash) {
        return c.json(
          {
            error:
              "Immediate upgrades require a confirmed prorated payment transaction hash.",
            data: {
              mode: "immediate_prorated_upgrade",
              proration: proration.response,
            },
          },
          400,
          corsHeaders(origin),
        );
      }

      if (
        normalizedPaymentTxHash &&
        consumedPaymentTxHashes.includes(normalizedPaymentTxHash)
      ) {
        return c.json(
          {
            error:
              "This prorated payment transaction hash has already been used for a previous plan change.",
          },
          409,
          corsHeaders(origin),
        );
      }

      if (
        normalizedRequestedAccessChangeTxHash &&
        consumedPaymentTxHashes.includes(normalizedRequestedAccessChangeTxHash)
      ) {
        return c.json(
          {
            error:
              "This subscription access-change transaction hash has already been used for a previous plan change.",
          },
          409,
          corsHeaders(origin),
        );
      }

      const subChainId = company.subscriptionState?.chainId;

      if (normalizedPaymentTxHash && proration.amountDueMicros > 0n) {
        const paymentCheck = await verifyDirectErc20Transfer({
          acceptedToken: verification.acceptedToken,
          txHash: normalizedPaymentTxHash,
          expectedAmountAtomic: proration.amountDueMicros,
          recipientWallet: verification.merchantWallet,
          senderWallet: companyPaymentAccount,
          chainId: subChainId,
        });
        if (!paymentCheck.ok) {
          return c.json(
            { error: paymentCheck.error },
            paymentCheck.status as any,
            corsHeaders(origin),
          );
        }
      }

      let accessChangeTxHashLocal = normalizedRequestedAccessChangeTxHash;
      if (!accessChangeTxHashLocal) {
        const { contracts } = createChainClients(subChainId);
        const subscriptionRegistryAddress =
          contracts.subscriptionRegistry as `0x${string}`;
        if (
          !subscriptionRegistryAddress ||
          !isAddress(subscriptionRegistryAddress)
        ) {
          return c.json(
            { error: "Subscription registry is not configured for this chain." },
            503,
            corsHeaders(origin),
          );
        }

        const accessChangeCalldata = encodeFunctionData({
          abi: SubscriptionRegistryABI,
          functionName: "changePlan",
          args: [BigInt(verification.tokenId), BigInt(plan.onChainPlanId!)],
        });

        return c.json(
          {
            data: {
              ...buildLifecycleResponse({
                changeType: "upgrade",
                stage: "pending_verification",
                scheduled: false,
                mode: "immediate_prorated_upgrade",
                pendingVerification: true,
                data: {
                  planId,
                  planName: plan.name,
                  previousPlanId: previousPlanId ?? null,
                  autopayConfigTxHash: normalizedAutopayConfigTxHash,
                  paymentTxHash: normalizedPaymentTxHash,
                  proration: proration.response,
                  accessChangeRequired: true,
                  accessChangeScope: "subscription_registry_plan_change",
                  accessChangeNote:
                    "Submit the prepared SubscriptionRegistry.changePlan transaction from an authorized biller account, then call this endpoint again with accessChangeTxHash.",
                  preparedTransaction: {
                    chainId: subChainId ?? DEFAULT_CHAIN_ID,
                    target: subscriptionRegistryAddress,
                    value: "0",
                    data: accessChangeCalldata,
                    functionSignature: "changePlan(uint256,uint256)",
                  },
                  verification: {
                    paymentAccount: companyPaymentAccount,
                    tokenId: verification.tokenId,
                    currentOnChainPlanId: verification.previousOnChainPlanId,
                    targetOnChainPlanId: plan.onChainPlanId,
                  },
                },
              }),
            },
          },
          202,
          corsHeaders(origin),
        );
      }

      const accessChange = await verifySubscriptionRegistryPlanChange({
        paymentAccount: companyPaymentAccount,
        txHash: accessChangeTxHashLocal,
        expectedOnChainPlanId: plan.onChainPlanId!,
        chainId: subChainId,
      });
      if (!accessChange.ok) {
        return c.json(
          { error: accessChange.error },
          accessChange.status as any,
          corsHeaders(origin),
        );
      }

      let upgradeResult: {
        transitionId: string;
        invoiceId: string | null;
        paymentId: string | null;
      };
      try {
        upgradeResult = await db.$transaction(
          async (tx) => {
            const latestCompany = await tx.arcenCompany.findUnique({
              where: { id: companyId },
              select: { traits: true },
            });
            const latestTraits = asRecord(latestCompany?.traits);
            const latestConsumedPaymentTxHashes =
              readConsumedPaymentTxHashes(latestTraits);
            const alreadyConsumed =
              latestConsumedPaymentTxHashes.includes(normalizedAutopayConfigTxHash) ||
              latestConsumedPaymentTxHashes.includes(accessChangeTxHashLocal) ||
              (normalizedPaymentTxHash
                ? latestConsumedPaymentTxHashes.includes(normalizedPaymentTxHash)
                : false);

            if (alreadyConsumed) {
              throw new Error("PLAN_CHANGE_TX_REUSED");
            }

            const nextTraits: Record<string, unknown> =
              stripLegacySubscriptionLifecycleTraits(latestTraits);
            nextTraits.billingPeriod = normalizedBillingPeriod;
            nextTraits.billingVerifiedTxHashes = [
              ...latestConsumedPaymentTxHashes,
              normalizedAutopayConfigTxHash,
              accessChangeTxHashLocal,
              ...(normalizedPaymentTxHash ? [normalizedPaymentTxHash] : []),
            ].slice(-20);

            await tx.arcenCompany.update({
              where: { id: companyId },
              data: {
                activePlanId: plan.id,
                traits: toPrismaJson(nextTraits),
              },
            });

            const subscriptionState = await upsertSubscriptionLedgerState({
              teamId,
              companyId,
              walletAddress: companyPaymentAccount,
              status: "ACTIVE",
              catalogPlanId: plan.id,
              onChainPlanId: accessChange.onChainPlanId,
              onChainTokenId: accessChange.tokenId,
              currentPeriodStart: periodStart,
              currentPeriodEnd: periodEnd,
              cancelAtPeriodEnd: undefined,
              cancelledAt: undefined,
              pastDueAt: null,
              graceEndsAt: null,
              lastEvent: "subscription.plan_upgraded",
              lastEventAt: effectiveAt,
              lastSourceTxHash: accessChangeTxHashLocal,
              metadata: {
                source: "self_service",
                mode: "immediate_prorated_upgrade",
                billingPeriod: normalizedBillingPeriod,
                previousBillingPeriod: currentBillingPeriod,
                previousCatalogPlanId: previousPlanId ?? null,
                previousOnChainPlanId: accessChange.previousOnChainPlanId,
                proration: proration.response,
                autopayConfigTxHash: normalizedAutopayConfigTxHash,
                accessChangeTxHash: accessChangeTxHashLocal,
                paymentTxHash: normalizedPaymentTxHash,
              },
            }, tx);

            const changeRequest = await createSubscriptionChangeRequest({
              teamId,
              environmentId:
                company.subscriptionState?.environmentId ??
                company.environmentId ??
                plan.environmentId ??
                null,
              companyId,
              subscriptionStateId: subscriptionState?.id ?? null,
              changeType: "upgrade",
              stage: "applied",
              source: "self_service",
              previousPlanId: previousPlanId ?? null,
              targetPlanId: plan.id,
              previousBillingPeriod: currentBillingPeriod,
              targetBillingPeriod: normalizedBillingPeriod,
              requestedAt: effectiveAt,
              effectiveAt,
              appliedAt: effectiveAt,
              autopayConfigTxHash: normalizedAutopayConfigTxHash,
              accessChangeTxHash: accessChangeTxHashLocal,
              paymentTxHash: normalizedPaymentTxHash,
              metadata: {
                mode: "immediate_prorated_upgrade",
                targetPlanName: plan.name,
                previousPlanId: previousPlanId ?? null,
                previousBillingPeriod: currentBillingPeriod,
                targetBillingPeriod: normalizedBillingPeriod,
                proration: proration.response,
              },
            }, tx);

            let invoiceId: string | null = null;
            let paymentId: string | null = null;
            if (proration.amountDueMicros > 0n && normalizedPaymentTxHash) {
              const invoice = await createProrationInvoice({
                teamId,
                companyId,
                customerName: resolvedCompanyName,
                customerEmail: resolvedCompanyEmail,
                customerWallet: companyPaymentAccount,
                planId: plan.id,
                currentPlanName: currentPlan?.name ?? "Current plan",
                targetPlanName: plan.name,
                targetRemainingMicros: proration.quote.targetRemainingMicros,
                currentRemainingMicros: proration.quote.currentRemainingMicros,
                amountDueMicros: proration.amountDueMicros,
                issuedAt: effectiveAt,
                metadata: {
                  source: "self_service",
                  mode: "immediate_prorated_upgrade",
                  billingPeriod: normalizedBillingPeriod,
                  previousBillingPeriod: currentBillingPeriod,
                  previousPlanId: previousPlanId ?? null,
                  autopayConfigTxHash: normalizedAutopayConfigTxHash,
                  accessChangeTxHash: accessChangeTxHashLocal,
                  paymentTxHash: normalizedPaymentTxHash,
                  proration: proration.response,
                },
              }, tx);
              invoiceId = invoice.id;

              const payment = await recordSuccessfulPayment({
                idempotencyKey: `payment:plan_change.upgrade:${normalizedPaymentTxHash}`,
                teamId,
                companyId,
                walletAddress: companyPaymentAccount,
                invoiceId,
                subscriptionStateId: subscriptionState?.id,
                kind: "SUBSCRIPTION_PLAN_CHANGE_UPGRADE",
                amount: microsToAmount(proration.amountDueMicros),
                currency: "USDC",
                payerWallet: companyPaymentAccount,
                recipientWallet: verification.merchantWallet,
                acceptedToken: verification.acceptedToken,
                txHash: normalizedPaymentTxHash,
                occurredAt: effectiveAt,
                settledAt: effectiveAt,
                preserveScheduledCancellation: true,
                metadata: {
                  source: "self_service",
                  mode: "immediate_prorated_upgrade",
                  billingPeriod: normalizedBillingPeriod,
                  previousBillingPeriod: currentBillingPeriod,
                  autopayConfigTxHash: normalizedAutopayConfigTxHash,
                  accessChangeTxHash: accessChangeTxHashLocal,
                  proration: proration.response,
                },
              }, tx);
              paymentId = payment.id;

              await recordBillingAdjustment({
                teamId,
                companyId,
                subscriptionStateId: subscriptionState?.id,
                paymentId,
                kind: "UPGRADE_PRORATION_CHARGE",
                status: "POSTED",
                amount: microsToAmount(proration.amountDueMicros),
                fromCatalogPlanId: previousPlanId ?? null,
                toCatalogPlanId: plan.id,
                periodStartedAt: periodStart,
                periodEndsAt: periodEnd,
                effectiveAt,
                postedAt: effectiveAt,
                metadata: {
                  source: "self_service",
                  billingPeriod: normalizedBillingPeriod,
                  previousBillingPeriod: currentBillingPeriod,
                  autopayConfigTxHash: normalizedAutopayConfigTxHash,
                  accessChangeTxHash: accessChangeTxHashLocal,
                  paymentTxHash: normalizedPaymentTxHash,
                  proration: proration.response,
                },
              }, tx);
            }

            if (proration.creditMicros > 0n) {
              await recordBillingAdjustment({
                teamId,
                companyId,
                subscriptionStateId: subscriptionState?.id,
                kind: "DOWNGRADE_PRORATION_CREDIT",
                status: "POSTED",
                amount: microsToAmount(proration.creditMicros),
                fromCatalogPlanId: previousPlanId ?? null,
                toCatalogPlanId: plan.id,
                periodStartedAt: periodStart,
                periodEndsAt: periodEnd,
                effectiveAt,
                postedAt: effectiveAt,
                metadata: {
                  source: "self_service",
                  billingPeriod: normalizedBillingPeriod,
                  previousBillingPeriod: currentBillingPeriod,
                  autopayConfigTxHash: normalizedAutopayConfigTxHash,
                  accessChangeTxHash: accessChangeTxHashLocal,
                  proration: proration.response,
                },
              }, tx);
            }

            return { transitionId: changeRequest.id, invoiceId, paymentId };
          },
          { isolationLevel: "Serializable" },
        );
      } catch (error) {
        const code =
          typeof error === "object" && error !== null && "code" in error
            ? String((error as { code?: unknown }).code)
            : null;
        const message = error instanceof Error ? error.message : "";
        if (message === "PLAN_CHANGE_TX_REUSED" || code === "P2034") {
          return c.json(
            {
              error:
                "This plan change is already being processed or one of its transaction hashes was already consumed. Refresh the subscription state and retry if needed.",
            },
            409,
            corsHeaders(origin),
          );
        }
        throw error;
      }

      const { transitionId, invoiceId, paymentId } = upgradeResult;

      if (invoiceId && normalizedPaymentTxHash) {
        await sendPaidInvoiceReceipt({
          teamId,
          invoiceId,
          txHash: normalizedPaymentTxHash,
        }).catch((err) => {
          console.warn(
            "[company-plan] Failed to send proration invoice receipt:",
            err,
          );
        });
      }

      deliverWebhook(teamId, "company.plan.changed", {
        companyId,
        environmentId:
          company.subscriptionState?.environmentId ??
          company.environmentId ??
          plan.environmentId ??
          null,
        transitionId,
        changeType: "upgrade",
        stage: "applied",
        planId,
        planName: plan.name,
        billingPeriod: normalizedBillingPeriod,
        previousPlanId: previousPlanId ?? null,
        mode: "immediate_prorated_upgrade",
        scheduled: false,
        txHash: accessChangeTxHashLocal,
        autopayConfigTxHash: normalizedAutopayConfigTxHash,
        accessChangeTxHash: accessChangeTxHashLocal,
        paymentTxHash: normalizedPaymentTxHash,
        invoiceId,
        paymentId,
        onChainPlanId: accessChange.onChainPlanId,
        tokenId: accessChange.tokenId,
        verifiedOnChain: true,
        proration: proration.response,
      }).catch(() => {});

      return c.json(
        {
          data: {
            ...buildLifecycleResponse({
              transitionId,
              changeType: "upgrade",
              stage: "applied",
              scheduled: false,
              mode: "immediate_prorated_upgrade",
              effectiveAt: accessChange.currentPeriodEnd,
              data: {
                planId,
                planName: plan.name,
                previousPlanId: previousPlanId ?? null,
                onChainPlanId: accessChange.onChainPlanId,
                tokenId: accessChange.tokenId,
                currentPeriodEnd: accessChange.currentPeriodEnd,
                autopayConfigTxHash: normalizedAutopayConfigTxHash,
                accessChangeTxHash: accessChangeTxHashLocal,
                paymentTxHash: normalizedPaymentTxHash,
                invoiceId,
                paymentId,
                proration: proration.response,
              },
            }),
          },
        },
        200,
        corsHeaders(origin),
      );
    }

    const scheduledChangeType = isDowngrade
      ? "downgrade"
      : "billing_period_change";
    const scheduledMode = isDowngrade
      ? "period_end_downgrade"
      : "next_renewal_on_chain";
    const transition: SubscriptionTransition = {
      mode: scheduledMode,
      changeType: scheduledChangeType,
      stage: "requested",
      targetPlanId: plan.id,
      targetPlanName: plan.name,
      targetBillingPeriod: normalizedBillingPeriod,
      previousPlanId: previousPlanId ?? null,
      previousBillingPeriod: currentBillingPeriod,
      requestedAt: new Date().toISOString(),
      effectiveAt: verification.currentPeriodEnd,
      source: "self_service",
    };
    const applyAccessPlanImmediately =
      targetPlanAmountMicros >= currentPlanAmountMicros;
    const effectiveCatalogPlanId = applyAccessPlanImmediately
      ? plan.id
      : currentPlan?.id ?? previousPlanId ?? null;
    const changeRequest = await createSubscriptionChangeRequest({
      teamId,
      environmentId:
        company.subscriptionState?.environmentId ??
        company.environmentId ??
        plan.environmentId ??
        null,
      companyId,
      subscriptionStateId: company.subscriptionState?.id ?? null,
      changeType: scheduledChangeType,
      stage: "requested",
      source: "self_service",
      previousPlanId: previousPlanId ?? null,
      targetPlanId: plan.id,
      previousBillingPeriod: currentBillingPeriod,
      targetBillingPeriod: normalizedBillingPeriod,
      requestedAt: new Date(),
      effectiveAt: new Date(verification.currentPeriodEnd),
      autopayConfigTxHash: normalizedAutopayConfigTxHash,
      metadata: {
        mode: scheduledMode,
        targetPlanName: plan.name,
        accessPlanAppliedImmediately: applyAccessPlanImmediately,
        pendingOnChainPlanId: verification.onChainPlanId,
      },
    });
    transition.transitionId = changeRequest.id;

    const nextTraits: Record<string, unknown> = {
      ...stripLegacySubscriptionLifecycleTraits(currentTraits),
      billingPeriod: applyAccessPlanImmediately
        ? normalizedBillingPeriod
        : currentBillingPeriod,
      billingVerifiedTxHashes: [
        ...consumedPaymentTxHashes,
        normalizedAutopayConfigTxHash,
      ].slice(-20),
    };

    await db.arcenCompany.update({
      where: { id: companyId },
      data: {
        ...(effectiveCatalogPlanId ? { activePlanId: effectiveCatalogPlanId } : {}),
        traits: toPrismaJson(nextTraits),
      },
    });

    await upsertSubscriptionLedgerState({
      teamId,
      companyId,
      walletAddress: companyPaymentAccount,
      status: "ACTIVE",
      catalogPlanId: effectiveCatalogPlanId,
      onChainPlanId: applyAccessPlanImmediately
        ? verification.onChainPlanId
        : currentPlan?.onChainPlanId ?? verification.previousOnChainPlanId,
      onChainTokenId: verification.tokenId,
      currentPeriodEnd: new Date(verification.currentPeriodEnd),
      cancelAtPeriodEnd: false,
      cancelledAt: null,
      pastDueAt: null,
      graceEndsAt: null,
      lastEvent: "subscription.plan_change_pending",
      lastEventAt: new Date(),
      lastSourceTxHash: normalizedAutopayConfigTxHash,
      metadata: {
        source: "self_service",
        billingPeriod: applyAccessPlanImmediately
          ? normalizedBillingPeriod
          : currentBillingPeriod,
        pendingBillingPeriod: normalizedBillingPeriod,
        previousBillingPeriod: currentBillingPeriod,
        accessPlanAppliedImmediately: applyAccessPlanImmediately,
        pendingCatalogPlanId: plan.id,
        pendingOnChainPlanId: verification.onChainPlanId,
        previousCatalogPlanId: previousPlanId ?? null,
        previousOnChainPlanId: verification.previousOnChainPlanId,
      },
    });

    deliverWebhook(teamId, "company.plan.changed", {
      companyId,
      environmentId:
        company.subscriptionState?.environmentId ??
        company.environmentId ??
        plan.environmentId ??
        null,
      transitionId: changeRequest.id,
      changeType: scheduledChangeType,
      stage: "requested",
      planId,
      planName: plan.name,
      billingPeriod: normalizedBillingPeriod,
      previousPlanId: previousPlanId ?? null,
      targetPlanId: plan.id,
      mode: scheduledMode,
      scheduled: true,
      txHash: normalizedAutopayConfigTxHash,
      onChainPlanId: verification.onChainPlanId,
      verifiedOnChain: true,
      effectiveAt: verification.currentPeriodEnd,
      accessPlanAppliedImmediately: applyAccessPlanImmediately,
      proration: {
        currency: "USDC",
        amountDue: "0.000000",
        amountPaid: "0.000000",
        amountRemaining: "0.000000",
        note: "Downgrade access changes at the current period end.",
      },
    }).catch(() => {});

    return c.json(
      {
        data: {
          ...buildLifecycleResponse({
            transitionId: changeRequest.id,
            changeType: scheduledChangeType,
            stage: "requested",
            scheduled: true,
            mode: scheduledMode,
            effectiveAt: verification.currentPeriodEnd,
            data: {
              planId,
              planName: plan.name,
              previousPlanId: previousPlanId ?? null,
              onChainPlanId: verification.onChainPlanId,
              tokenId: verification.tokenId,
              currentPeriodEnd: verification.currentPeriodEnd,
              accessPlanAppliedImmediately: applyAccessPlanImmediately,
              proration: {
                currency: "USDC",
                amountDue: "0.000000",
                amountPaid: "0.000000",
                amountRemaining: "0.000000",
                note: "Downgrade access changes at the current period end.",
              },
            },
          }),
        },
      },
      200,
      corsHeaders(origin),
    );
  }

  if (!shouldScheduleDowngrade && quotedAmountMicros > 0) {
    if (!company.walletAddress) {
      return c.json(
        {
          error:
            "The company must have a linked wallet before a self-serve paid plan change can be verified.",
        },
        409,
        corsHeaders(origin),
      );
    }

    const normalizedTxHash = normalizeTxHash(txHash);
    if (!normalizedTxHash) {
      return c.json(
        {
          error:
            "Paid plan changes require a confirmed payment transaction hash.",
        },
        400,
        corsHeaders(origin),
      );
    }

    if (consumedPaymentTxHashes.includes(normalizedTxHash)) {
      return c.json(
        {
          error:
            "This payment transaction hash has already been used for a previous plan change.",
        },
        409,
        corsHeaders(origin),
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
      return c.json(
        { error: paymentCheck.error },
        paymentCheck.status as any,
        corsHeaders(origin),
      );
    }
  }

  if (shouldScheduleDowngrade) {
    const existingRequest = await findSimilarOpenSubscriptionChangeRequest({
      teamId,
      companyId,
      changeType: "downgrade",
      targetPlanId: plan.id,
    });
    const transition: SubscriptionTransition = {
      mode: "period_end_downgrade",
      changeType: "downgrade",
      stage: "requested",
      targetPlanId: plan.id,
      targetPlanName: plan.name,
      targetBillingPeriod: normalizedBillingPeriod,
      previousPlanId: previousPlanId ?? null,
      previousBillingPeriod: currentBillingPeriod,
      requestedAt: new Date().toISOString(),
      effectiveAt: null,
      source: "self_service",
    };

    const now = new Date();
    const changeRequest = await db.$transaction(async (tx) => {
      const nextRequest = existingRequest
        ? await tx.subscriptionChangeRequest.update({
            where: { id: existingRequest.id },
            data: {
              stage: "REQUESTED",
              targetPlanId: plan.id,
              previousPlanId: previousPlanId ?? null,
              previousBillingPeriod: currentBillingPeriod,
              targetBillingPeriod: normalizedBillingPeriod,
              effectiveAt: company.subscriptionState?.currentPeriodEnd ?? null,
              failureReason: null,
              metadata: toPrismaJson({
                ...transition,
                mode: "period_end_downgrade",
                requiresOnChainSync: false,
              }),
            },
          })
        : await createSubscriptionChangeRequest(
            {
              teamId,
              environmentId:
                company.subscriptionState?.environmentId ??
                company.environmentId ??
                plan.environmentId ??
                null,
              companyId,
              subscriptionStateId: company.subscriptionState?.id ?? null,
              changeType: "downgrade",
              stage: "requested",
              source: "self_service",
              previousPlanId: previousPlanId ?? null,
              targetPlanId: plan.id,
              previousBillingPeriod: currentBillingPeriod,
              targetBillingPeriod: normalizedBillingPeriod,
              requestedAt: now,
              effectiveAt: company.subscriptionState?.currentPeriodEnd ?? null,
              metadata: {
                ...transition,
                mode: "period_end_downgrade",
                requiresOnChainSync: false,
              },
            },
            tx,
          );

      await tx.arcenCompany.update({
        where: { id: companyId },
        data: {
          traits: toPrismaJson({
            ...stripLegacySubscriptionLifecycleTraits(currentTraits),
            billingPeriod: currentBillingPeriod,
          }),
        },
      });

      return nextRequest;
    });
    transition.transitionId = changeRequest.id;

    deliverWebhook(teamId, "company.plan.changed", {
      companyId,
      environmentId:
        company.subscriptionState?.environmentId ??
        company.environmentId ??
        plan.environmentId ??
        null,
      transitionId: changeRequest.id,
      changeType: "downgrade",
      stage: "requested",
      planId,
      planName: plan.name,
      billingPeriod: normalizedBillingPeriod,
      previousPlanId: previousPlanId ?? null,
      targetPlanId: plan.id,
      mode: "period_end",
      scheduled: true,
      ...(normalizedCouponCode ? { couponCode: normalizedCouponCode } : {}),
    }).catch(() => {});

    return c.json(
      {
        data: {
          ...buildLifecycleResponse({
            transitionId: changeRequest.id,
            changeType: "downgrade",
            stage: "requested",
            scheduled: true,
            mode: "period_end",
            effectiveAt:
              company.subscriptionState?.currentPeriodEnd?.toISOString() ?? null,
            data: {
              planId,
              planName: plan.name,
              previousPlanId: previousPlanId ?? null,
            },
          }),
        },
      },
      200,
      corsHeaders(origin),
    );
  }

  const nextTraits = stripLegacySubscriptionLifecycleTraits(currentTraits);
  nextTraits.billingPeriod = normalizedBillingPeriod;
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

  const immediateChangeRequest = await createSubscriptionChangeRequest({
    teamId,
    environmentId:
      company.subscriptionState?.environmentId ??
      company.environmentId ??
      plan.environmentId ??
      null,
    companyId,
    subscriptionStateId: company.subscriptionState?.id ?? null,
    changeType:
      targetPlanAmountMicros > currentPlanAmountMicros
        ? "upgrade"
        : "billing_period_change",
    stage: "applied",
    source: "self_service",
    previousPlanId: previousPlanId ?? null,
    targetPlanId: plan.id,
    previousBillingPeriod: currentBillingPeriod,
    targetBillingPeriod: normalizedBillingPeriod,
    requestedAt: new Date(),
    appliedAt: new Date(),
    metadata: {
      mode: "immediate",
      targetPlanName: plan.name,
      chargedAmount: quoteResult.quote.finalAmount,
    },
  });

  // Fire outbound webhook (non-blocking)
  deliverWebhook(teamId, "company.plan.changed", {
    companyId,
    environmentId:
      company.subscriptionState?.environmentId ??
      company.environmentId ??
      plan.environmentId ??
      null,
    transitionId: immediateChangeRequest.id,
    changeType:
      targetPlanAmountMicros > currentPlanAmountMicros
        ? "upgrade"
        : "billing_period_change",
    stage: "applied",
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

  return c.json(
    {
      data: {
        ...buildLifecycleResponse({
          transitionId: immediateChangeRequest.id,
          changeType:
            targetPlanAmountMicros > currentPlanAmountMicros
              ? "upgrade"
              : "billing_period_change",
          stage: "applied",
          scheduled: false,
          mode: "immediate",
          data: {
            planId,
            planName: plan.name,
            previousPlanId: previousPlanId ?? null,
          },
        }),
      },
    },
    200,
    corsHeaders(origin),
  );
}

export async function POST(c: Context) {
  return handleCompanyPlanRequest(c);
}
