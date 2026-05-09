/**
 * POST /api/v1/companies/plan
 *
 * Switch the authenticated company's active plan.
 * Auth: Bearer <embed_access_token>
 * Body: { planId: string, customerEmail?: string }
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { privateKeyToAccount } from "viem/accounts";
import {
  createPublicClient,
  createWalletClient,
  http,
  isAddress,
} from "viem";
import { deliverWebhook } from "@/lib/deliver-webhook";
import { resolveEntitlementResults } from "@/lib/entitlements";
import {
  extractEmbedAccessToken,
  resolveEmbedAccessToken,
} from "@/lib/embed-access-token";
import { toPrismaJson } from "@/lib/prisma-json";
import { allocateInvoiceNumber } from "@/lib/invoices";
import {
  incrementCouponRedemption,
  normalizeBillingPeriod,
  normalizeCouponCode,
  resolvePlanAmountMicros,
  resolveCouponQuote,
} from "@/lib/catalog-billing";
import {
  recordSuccessfulPayment,
  upsertSubscriptionLedgerState,
} from "@/lib/billing-ledger";
import { recordBillingAdjustment } from "@/lib/billing-adjustments";
import { computeProrationQuote } from "@/lib/billing-proration";
import {
  normalizeTxHash,
  verifyAutopayPlanChange,
  verifyDirectErc20Transfer,
  verifySubscriptionRegistryPlanChange,
} from "@/lib/onchain-payment-verification";
import { SELF_SERVE_PLAN_CHANGES_ENABLED } from "@/lib/launch-flags";
import {
  getChain,
  getContractAddresses,
  SubscriptionRegistryABI,
} from "@arcenpay/internal-core";
import { getRpcUrl } from "@/lib/config";
import { DEFAULT_CHAIN_ID } from "@/lib/default-chain";

type PlanRouteDb = Pick<
  typeof db,
  "team" | "invoice" | "arcenCompany" | "subscriptionState" | "payment" | "paymentAttempt" | "billingAdjustment"
>;

type SubscriptionTransition = {
  mode:
    | "period_end_downgrade"
    | "cancel_at_period_end"
    | "next_renewal_on_chain";
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

import { corsHeaders } from "@/lib/cors";

function normalizePrivateKey(raw: string | undefined): `0x${string}` | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withPrefix = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  return /^0x[a-fA-F0-9]{64}$/.test(withPrefix)
    ? (withPrefix as `0x${string}`)
    : null;
}

function requiredConfirmations(): number {
  const raw = process.env.ONCHAIN_MIN_CONFIRMATIONS?.trim();
  if (!raw) return 2;

  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 2;
}

function createChainClients() {
  const chainId = DEFAULT_CHAIN_ID;
  const chain = getChain(chainId);
  return {
    chain,
    publicClient: createPublicClient({
      chain,
      transport: http(getRpcUrl(chainId)),
    }),
    contracts: getContractAddresses(chainId),
  };
}

function resolveAuthorizedRegistryPlanChangeCapability() {
  const billerPrivateKey = normalizePrivateKey(
    process.env.SUBSCRIPTION_BILLER_PRIVATE_KEY ||
      process.env.BILLER_PRIVATE_KEY ||
      process.env.PRIVATE_KEY ||
      process.env.ONCHAIN_PROVIDER_PRIVATE_KEY ||
      process.env.DEPLOYER_PRIVATE_KEY,
  );

  if (!billerPrivateKey) {
    return {
      ok: false as const,
      status: 503,
      error:
        "Subscription biller signer is not configured on the backend. Set SUBSCRIPTION_BILLER_PRIVATE_KEY for immediate upgrades.",
    };
  }

  return {
    ok: true as const,
    billerPrivateKey,
  };
}

async function executeAuthorizedRegistryPlanChange(input: {
  tokenId: string;
  expectedOnChainPlanId: string;
}) {
  const capability = resolveAuthorizedRegistryPlanChangeCapability();
  if (!capability.ok) {
    return capability;
  }
  const { billerPrivateKey } = capability;

  const { chain, publicClient, contracts } = createChainClients();
  const subscriptionRegistryAddress =
    contracts.subscriptionRegistry as `0x${string}`;

  if (
    !subscriptionRegistryAddress ||
    !isAddress(subscriptionRegistryAddress)
  ) {
    return {
      ok: false as const,
      status: 503,
      error: "Subscription registry is not configured for this chain.",
    };
  }

  const signerAccount = privateKeyToAccount(billerPrivateKey);
  const authorized = (await publicClient.readContract({
    address: subscriptionRegistryAddress,
    abi: [
      {
        inputs: [{ internalType: "address", name: "", type: "address" }],
        name: "authorizedBillers",
        outputs: [{ internalType: "bool", name: "", type: "bool" }],
        stateMutability: "view",
        type: "function",
      },
    ] as const,
    functionName: "authorizedBillers",
    args: [signerAccount.address],
  })) as boolean;

  if (!authorized) {
    return {
      ok: false as const,
      status: 409,
      error:
        "The configured backend signer is not authorized as a SubscriptionRegistry biller, so immediate upgrades cannot finalize access yet.",
    };
  }

  const walletClient = createWalletClient({
    account: signerAccount,
    chain,
    transport: http(getRpcUrl(chain.id)),
  });

  const txHash = await walletClient.writeContract({
    account: signerAccount,
    chain,
    address: subscriptionRegistryAddress,
    abi: SubscriptionRegistryABI,
    functionName: "changePlan",
    args: [BigInt(input.tokenId), BigInt(input.expectedOnChainPlanId)],
  });

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
    confirmations: requiredConfirmations(),
  });
  if (receipt.status !== "success") {
    return {
      ok: false as const,
      status: 502,
      error: "Authorized SubscriptionRegistry plan change transaction failed.",
    };
  }

  return {
    ok: true as const,
    txHash,
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
  const unusedCreditMicros = -quote.currentRemainingMicros;

  return {
    quote,
    amountDueMicros,
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
      amountRemaining: "0.000000",
    },
  };
}

async function createProrationInvoice(input: {
  teamId: string;
  companyId: string;
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
      metadata: toPrismaJson(input.metadata ?? {}),
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

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function POST(req: NextRequest) {
  if (!SELF_SERVE_PLAN_CHANGES_ENABLED) {
    return NextResponse.json(
      {
        error:
          "Self-service plan changes are disabled for this launch. Start a new subscription through checkout or contact support for plan changes.",
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
    planChangeTxHash?: string;
    autopayConfigTxHash?: string;
    accessChangeTxHash?: string;
    paymentTxHash?: string;
    previewOnly?: boolean;
    scheduleAtPeriodEnd?: boolean;
    couponCode?: string;
    customerEmail?: string;
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
    planChangeTxHash,
    autopayConfigTxHash,
    accessChangeTxHash,
    paymentTxHash,
    previewOnly,
    scheduleAtPeriodEnd,
    couponCode,
    customerEmail,
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
      billingInterval: true,
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
      subscriptionState: {
        select: {
          id: true,
          walletAddress: true,
          currentPeriodStart: true,
          currentPeriodEnd: true,
          onChainTokenId: true,
          metadata: true,
        },
      },
    },
  });
  if (!company) {
    return NextResponse.json(
      { error: "Company not found" },
      { status: 404, headers: corsHeaders() },
    );
  }

  const companyPaymentAccount =
    company.subscriptionState?.walletAddress ?? company.walletAddress ?? null;

  const normalizedCustomerEmail =
    typeof customerEmail === "string" ? customerEmail.trim() : "";
  const hasCustomerEmail =
    normalizedCustomerEmail.length > 0 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedCustomerEmail);

  if (normalizedCustomerEmail && !hasCustomerEmail) {
    return NextResponse.json(
      { error: "customerEmail must be a valid email address" },
      { status: 400, headers: corsHeaders() },
    );
  }

  if (hasCustomerEmail && company.email !== normalizedCustomerEmail) {
    await db.arcenCompany.update({
      where: { id: company.id },
      data: { email: normalizedCustomerEmail },
    });

    if (companyPaymentAccount) {
      await db.subscriberEmail.upsert({
        where: { walletAddress: companyPaymentAccount },
        update: {
          email: normalizedCustomerEmail,
          planId: company.activePlanId ?? planId,
        },
        create: {
          walletAddress: companyPaymentAccount,
          email: normalizedCustomerEmail,
          planId: company.activePlanId ?? planId,
        },
      });
    }
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
            billingInterval: true,
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
  const currentBillingPeriod =
    readStoredBillingPeriod(company.subscriptionState?.metadata) ??
    readStoredBillingPeriod(company.traits) ??
    deriveBillingPeriodFromPlan(currentPlan);
  const normalizedBillingPeriod =
    normalizeBillingPeriod(billingPeriod) ?? currentBillingPeriod;
  if (
    previousPlanId === plan.id &&
    currentBillingPeriod === normalizedBillingPeriod
  ) {
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

  const shouldScheduleDowngrade =
    !!currentPlan &&
    resolvePlanAmountMicros(plan, normalizedBillingPeriod) <
      resolvePlanAmountMicros(currentPlan, currentBillingPeriod) &&
    (scheduleAtPeriodEnd ?? !(catalogConfig?.downgradeImmediately ?? false));
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
    return NextResponse.json(
      { error: quoteResult.error },
      { status: quoteResult.status, headers: corsHeaders() },
    );
  }
  const normalizedCouponCode = normalizeCouponCode(couponCode);
  const quotedAmountMicros = quoteResult.quote.finalAmountMicros;

  if ((currentPrice > 0 || targetPrice > 0) && !usesAuthoritativeOnChainPlanChange) {
    return NextResponse.json(
      {
        error:
          "Self-service paid plan changes must use the authoritative on-chain subscription flows. Off-chain paid plan changes remain blocked.",
      },
      { status: 409, headers: corsHeaders() },
    );
  }

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

    if (normalizedCouponCode) {
      return NextResponse.json(
        {
          error:
            "Coupons are not supported for authoritative on-chain plan changes yet because discount state is not carried into the recurring subscription config.",
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
    if (!companyPaymentAccount) {
      return NextResponse.json(
        {
          error:
            "The company must have a linked payment account before an on-chain plan change can be verified.",
        },
        { status: 409, headers: corsHeaders() },
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
        return NextResponse.json(
          {
            error:
              "The current billing period is required before an upgrade can be prorated.",
          },
          { status: 409, headers: corsHeaders() },
        );
      }

      const capability = resolveAuthorizedRegistryPlanChangeCapability();
      if (!capability.ok) {
        return NextResponse.json(
          { error: capability.error },
          { status: capability.status, headers: corsHeaders() },
        );
      }

      const { publicClient, contracts } = createChainClients();
      const subscriptionRegistryAddress =
        contracts.subscriptionRegistry as `0x${string}`;
      if (
        !subscriptionRegistryAddress ||
        !isAddress(subscriptionRegistryAddress)
      ) {
        return NextResponse.json(
          { error: "Subscription registry is not configured for this chain." },
          { status: 503, headers: corsHeaders() },
        );
      }
      const signerAccount = privateKeyToAccount(capability.billerPrivateKey);
      const authorized = (await publicClient.readContract({
        address: subscriptionRegistryAddress,
        abi: [
          {
            inputs: [{ internalType: "address", name: "", type: "address" }],
            name: "authorizedBillers",
            outputs: [{ internalType: "bool", name: "", type: "bool" }],
            stateMutability: "view",
            type: "function",
          },
        ] as const,
        functionName: "authorizedBillers",
        args: [signerAccount.address],
      })) as boolean;

      if (!authorized) {
        return NextResponse.json(
          {
            error:
              "The configured backend signer is not authorized as a SubscriptionRegistry biller, so immediate upgrades cannot finalize access yet.",
          },
          { status: 409, headers: corsHeaders() },
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

      return NextResponse.json(
        {
          data: {
            success: true,
            previewOnly: true,
            scheduled: false,
            mode: "immediate_prorated_upgrade_preview",
            planId,
            planName: plan.name,
            previousPlanId: previousPlanId ?? null,
            proration: proration.response,
          },
        },
        { headers: corsHeaders() },
      );
    }

    const normalizedAutopayConfigTxHash = normalizeTxHash(
      autopayConfigTxHash ?? planChangeTxHash ?? txHash,
    );
    if (!normalizedAutopayConfigTxHash) {
      return NextResponse.json(
        {
          error:
            "Authoritative on-chain plan changes require the confirmed AutopayModule.updateConfig transaction hash.",
        },
        { status: 400, headers: corsHeaders() },
      );
    }

    if (consumedPaymentTxHashes.includes(normalizedAutopayConfigTxHash)) {
      return NextResponse.json(
        {
          error:
          "This autopay config transaction hash has already been used for a previous plan change.",
        },
        { status: 409, headers: corsHeaders() },
      );
    }

    const verification = await verifyAutopayPlanChange({
      paymentAccount: companyPaymentAccount,
      txHash: normalizedAutopayConfigTxHash,
      expectedOnChainPlanId: plan.onChainPlanId!,
    });
    if (!verification.ok) {
      return NextResponse.json(
        { error: verification.error },
        { status: verification.status, headers: corsHeaders() },
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
        return NextResponse.json(
          {
            error:
              "The current billing period is required before an upgrade can be prorated.",
          },
          { status: 409, headers: corsHeaders() },
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
        return NextResponse.json(
          {
            error:
              "Immediate upgrades require a confirmed prorated payment transaction hash.",
            data: {
              mode: "immediate_prorated_upgrade",
              proration: proration.response,
            },
          },
          { status: 400, headers: corsHeaders() },
        );
      }

      if (
        normalizedPaymentTxHash &&
        consumedPaymentTxHashes.includes(normalizedPaymentTxHash)
      ) {
        return NextResponse.json(
          {
            error:
              "This prorated payment transaction hash has already been used for a previous plan change.",
          },
          { status: 409, headers: corsHeaders() },
        );
      }

      if (
        normalizedRequestedAccessChangeTxHash &&
        consumedPaymentTxHashes.includes(normalizedRequestedAccessChangeTxHash)
      ) {
        return NextResponse.json(
          {
            error:
              "This subscription access-change transaction hash has already been used for a previous plan change.",
          },
          { status: 409, headers: corsHeaders() },
        );
      }

      if (normalizedPaymentTxHash && proration.amountDueMicros > 0n) {
        const paymentCheck = await verifyDirectErc20Transfer({
          acceptedToken: verification.acceptedToken,
          txHash: normalizedPaymentTxHash,
          expectedAmountAtomic: proration.amountDueMicros,
          recipientWallet: verification.merchantWallet,
          senderWallet: companyPaymentAccount,
        });
        if (!paymentCheck.ok) {
          return NextResponse.json(
            { error: paymentCheck.error },
            { status: paymentCheck.status, headers: corsHeaders() },
          );
        }
      }

      let accessChangeTxHash = normalizedRequestedAccessChangeTxHash;
      if (!accessChangeTxHash) {
        const accessChangeExecution = await executeAuthorizedRegistryPlanChange({
          tokenId: verification.tokenId,
          expectedOnChainPlanId: plan.onChainPlanId!,
        });
        if (!accessChangeExecution.ok) {
          return NextResponse.json(
            { error: accessChangeExecution.error },
            { status: accessChangeExecution.status, headers: corsHeaders() },
          );
        }
        accessChangeTxHash = accessChangeExecution.txHash;
      }

      const accessChange = await verifySubscriptionRegistryPlanChange({
        paymentAccount: companyPaymentAccount,
        txHash: accessChangeTxHash,
        expectedOnChainPlanId: plan.onChainPlanId!,
      });
      if (!accessChange.ok) {
        return NextResponse.json(
          { error: accessChange.error },
          { status: accessChange.status, headers: corsHeaders() },
        );
      }

      let upgradeResult: { invoiceId: string | null; paymentId: string | null };
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
              latestConsumedPaymentTxHashes.includes(accessChangeTxHash) ||
              (normalizedPaymentTxHash
                ? latestConsumedPaymentTxHashes.includes(normalizedPaymentTxHash)
                : false);

            if (alreadyConsumed) {
              throw new Error("PLAN_CHANGE_TX_REUSED");
            }

            const nextTraits: Record<string, unknown> = { ...latestTraits };
            delete nextTraits.subscriptionTransition;
            nextTraits.billingPeriod = normalizedBillingPeriod;
            nextTraits.billingVerifiedTxHashes = [
              ...latestConsumedPaymentTxHashes,
              normalizedAutopayConfigTxHash,
              accessChangeTxHash,
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
              cancelAtPeriodEnd: false,
              cancelledAt: null,
              pastDueAt: null,
              graceEndsAt: null,
              lastEvent: "subscription.plan_upgraded",
              lastEventAt: effectiveAt,
              lastSourceTxHash: accessChangeTxHash,
              metadata: {
                source: "self_service",
                mode: "immediate_prorated_upgrade",
                billingPeriod: normalizedBillingPeriod,
                previousBillingPeriod: currentBillingPeriod,
                previousCatalogPlanId: previousPlanId ?? null,
                previousOnChainPlanId: accessChange.previousOnChainPlanId,
                proration: proration.response,
                autopayConfigTxHash: normalizedAutopayConfigTxHash,
                accessChangeTxHash,
                paymentTxHash: normalizedPaymentTxHash,
              },
            }, tx);

            let invoiceId: string | null = null;
            let paymentId: string | null = null;
            if (proration.amountDueMicros > 0n && normalizedPaymentTxHash) {
              const invoice = await createProrationInvoice({
                teamId,
                companyId,
                customerEmail: company.email,
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
                  accessChangeTxHash,
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
                metadata: {
                  source: "self_service",
                  mode: "immediate_prorated_upgrade",
                  billingPeriod: normalizedBillingPeriod,
                  previousBillingPeriod: currentBillingPeriod,
                  autopayConfigTxHash: normalizedAutopayConfigTxHash,
                  accessChangeTxHash,
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
                  accessChangeTxHash,
                  paymentTxHash: normalizedPaymentTxHash,
                  proration: proration.response,
                },
              }, tx);
            }

            return { invoiceId, paymentId };
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
          return NextResponse.json(
            {
              error:
                "This plan change is already being processed or one of its transaction hashes was already consumed. Refresh the subscription state and retry if needed.",
            },
            { status: 409, headers: corsHeaders() },
          );
        }
        throw error;
      }

      const { invoiceId, paymentId } = upgradeResult;

      deliverWebhook(teamId, "company.plan.changed", {
        companyId,
        planId,
        planName: plan.name,
        billingPeriod: normalizedBillingPeriod,
        previousPlanId: previousPlanId ?? null,
        mode: "immediate_prorated_upgrade",
        scheduled: false,
        txHash: accessChangeTxHash,
        autopayConfigTxHash: normalizedAutopayConfigTxHash,
        accessChangeTxHash,
        paymentTxHash: normalizedPaymentTxHash,
        invoiceId,
        paymentId,
        onChainPlanId: accessChange.onChainPlanId,
        tokenId: accessChange.tokenId,
        verifiedOnChain: true,
        proration: proration.response,
      }).catch(() => {});

      return NextResponse.json(
        {
          data: {
            success: true,
            scheduled: false,
            mode: "immediate_prorated_upgrade",
            planId,
            planName: plan.name,
            previousPlanId: previousPlanId ?? null,
            onChainPlanId: accessChange.onChainPlanId,
            tokenId: accessChange.tokenId,
            currentPeriodEnd: accessChange.currentPeriodEnd,
            autopayConfigTxHash: normalizedAutopayConfigTxHash,
            accessChangeTxHash,
            paymentTxHash: normalizedPaymentTxHash,
            invoiceId,
            paymentId,
            proration: proration.response,
          },
        },
        { headers: corsHeaders() },
      );
    }

    const transition: SubscriptionTransition = {
      mode: "next_renewal_on_chain",
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

    const nextTraits: Record<string, unknown> = {
      ...currentTraits,
      billingPeriod: applyAccessPlanImmediately
        ? normalizedBillingPeriod
        : currentBillingPeriod,
      billingVerifiedTxHashes: [
        ...consumedPaymentTxHashes,
        normalizedAutopayConfigTxHash,
      ].slice(-20),
      subscriptionTransition: transition,
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
      planId,
      planName: plan.name,
      billingPeriod: normalizedBillingPeriod,
      previousPlanId: previousPlanId ?? null,
      mode: "next_renewal_on_chain",
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

    return NextResponse.json(
      {
        data: {
          success: true,
          scheduled: true,
          mode: "next_renewal_on_chain",
          planId,
          planName: plan.name,
          previousPlanId: previousPlanId ?? null,
          onChainPlanId: verification.onChainPlanId,
          tokenId: verification.tokenId,
          effectiveAt: verification.currentPeriodEnd,
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
      targetBillingPeriod: normalizedBillingPeriod,
      previousPlanId: previousPlanId ?? null,
      previousBillingPeriod: currentBillingPeriod,
      requestedAt: new Date().toISOString(),
      effectiveAt: null,
      source: "self_service",
    };

    await db.arcenCompany.update({
      where: { id: companyId },
      data: {
        traits: toPrismaJson({
          ...currentTraits,
          billingPeriod: currentBillingPeriod,
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
