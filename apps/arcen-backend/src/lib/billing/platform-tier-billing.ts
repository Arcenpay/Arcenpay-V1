import {
  createPublicClient,
  createWalletClient,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  http,
  isAddress,
  parseEventLogs,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  ERC7579AutopayModuleABI,
  MONTHLY_INTERVAL,
  PlanFactoryABI,
  SubscriptionRegistryABI,
  getChain,
  getContractAddresses,
  getTokenAddress,
} from "@arcenpay/internal-core";
import { db } from "../../db.js";
import { toPrismaJson } from "../../utils/prisma-json.js";
import { allocateInvoiceNumber, toSix } from "./invoices.js";
import {
  recordSuccessfulPayment,
  upsertSubscriptionLedgerState,
} from "./billing-ledger.js";
import { deliverWebhook } from "../webhooks/deliver-webhook.js";
import { TIER_PRICING } from "../catalog/tier-guard.js";
import { sendPaidInvoiceReceipt } from "./invoice-notifications.js";
import { syncEntitlementsToFlagRules } from "../entitlements/sync-entitlements.js";
import { resolveChainFamilyForPrisma } from "../platform/chain-family.js";
import {
  PLATFORM_BILLING_ACCEPTED_TOKEN,
  PLATFORM_BILLING_CHAIN_ID,
  PLATFORM_BILLING_OPS_PRIVATE_KEY,
  PLATFORM_BILLING_TREASURY_ADDRESS,
  getRpcUrl,
} from "../../config.js";
import type { PlatformTier } from "../../generated/client/client.js";

const PLATFORM_TIER_COMPANY_KEY = "arcenpay_platform_subscription";
const PLATFORM_BILLING_TIERS = ["PLUS", "PRO"] as const;
const PLATFORM_BILLING_INTERVAL_SECONDS = MONTHLY_INTERVAL;
// Platform catalog plans are environment-scoped. Cache by workspace,
// environment, and tier so one environment cannot hide or replace another.
const TIER_PLAN_IDS: Record<string, string> = {};

// ── Readiness types ──────────────────────────────────────────────────────────

export type PlatformBillingReadiness =
  | "NOT_CONFIGURED"       // env vars missing
  | "BOOTSTRAP_MISSING"    // plans not bootstrapped on-chain yet
  | "BOOTSTRAP_FAILED"     // bootstrap attempted but mismatch
  | "READY"                // plans exist and synced, upgrade available
  | "ACTIVE"               // team has active paid subscription
  | "PAST_DUE";            // team subscription is past due

function normalizeAddress(value?: string | null): `0x${string}` | null {
  const trimmed = value?.trim();
  if (!trimmed || !isAddress(trimmed)) return null;
  return trimmed.toLowerCase() as `0x${string}`;
}

function normalizePrivateKey(value?: string | null): `0x${string}` | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return (trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`) as `0x${string}`;
}

function buildTierIdempotencyKey(
  teamId: string,
  tier: string,
  paymentAccount: string,
  txHash: string,
): string {
  return `platform.tier.activate:${teamId}:${tier}:${paymentAccount.toLowerCase()}:${txHash.toLowerCase()}`;
}

function buildTierRenewalIdempotencyKey(
  teamId: string,
  tier: string,
  periodStart: Date,
): string {
  return `platform.tier.renew:${teamId}:${tier}:${periodStart.toISOString().split("T")[0]}`;
}

function tierPricing(tier: PlatformTier): {
  priceUsdPerMonth: number;
  amountMicros: number;
} {
  const plan = TIER_PRICING[tier];
  const price = tier === "FREE" ? 0 : plan.priceUsdc;
  return {
    priceUsdPerMonth: price,
    amountMicros: Math.round(price * 1_000_000),
  };
}

function tierPlanName(tier: PlatformTier): string {
  return `ArcenPay ${tier === "PRO" ? "Enterprise" : "Pro"} Plan`;
}

function platformPlanAmountAtomic(tier: PlatformTier): bigint {
  return BigInt(tierPricing(tier).amountMicros);
}

function platformBillingToken(): `0x${string}` {
  const configured = normalizeAddress(PLATFORM_BILLING_ACCEPTED_TOKEN);
  const fallback = normalizeAddress(
    getTokenAddress(PLATFORM_BILLING_CHAIN_ID, "USDC") ??
    getTokenAddress(PLATFORM_BILLING_CHAIN_ID, "USDT"),
  );
  const token = configured ?? fallback;
  if (!token) {
    throw new Error(
      `PLATFORM_BILLING_ACCEPTED_TOKEN must be set for chain ${PLATFORM_BILLING_CHAIN_ID}.`,
    );
  }
  return token;
}

function platformBillingTreasury(): `0x${string}` {
  const treasury = normalizeAddress(PLATFORM_BILLING_TREASURY_ADDRESS);
  if (!treasury) {
    throw new Error("PLATFORM_BILLING_TREASURY_ADDRESS must be set.");
  }
  return treasury;
}

function platformClients(chainId = PLATFORM_BILLING_CHAIN_ID) {
  const chain = getChain(chainId);
  const rpcUrl = getRpcUrl(chainId);
  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl || chain.rpcUrls.default.http[0]),
  });
  return { chain, publicClient };
}

function platformWalletClient() {
  const treasury = platformBillingTreasury();
  const candidateKeys = [
    normalizePrivateKey(PLATFORM_BILLING_OPS_PRIVATE_KEY),
    normalizePrivateKey(process.env.DEPLOYER_PRIVATE_KEY),
  ].filter((key): key is `0x${string}` => Boolean(key));
  const account = candidateKeys
    .map((key) => privateKeyToAccount(key))
    .find((candidate) => candidate.address.toLowerCase() === treasury.toLowerCase());
  if (!account) {
    throw new Error(
      "No configured platform billing signer matches PLATFORM_BILLING_TREASURY_ADDRESS. Set PLATFORM_BILLING_OPS_PRIVATE_KEY or DEPLOYER_PRIVATE_KEY to the treasury owner.",
    );
  }

  const chain = getChain(PLATFORM_BILLING_CHAIN_ID);
  const rpcUrl = getRpcUrl(PLATFORM_BILLING_CHAIN_ID);
  return {
    account,
    publicClient: createPublicClient({
      chain,
      transport: http(rpcUrl || chain.rpcUrls.default.http[0]),
    }),
    walletClient: createWalletClient({
      account,
      chain,
      transport: http(rpcUrl || chain.rpcUrls.default.http[0]),
    }),
  };
}

async function readOnChainPlatformPlan(
  planId: string,
  chainId = PLATFORM_BILLING_CHAIN_ID,
) {
  const contracts = getContractAddresses(chainId);
  const planFactoryAddress = normalizeAddress(contracts.planFactory);
  if (!planFactoryAddress) {
    throw new Error(`PlanFactory is not configured for chain ${chainId}.`);
  }
  const { publicClient } = platformClients(chainId);
  const raw = (await publicClient.readContract({
    address: planFactoryAddress,
    abi: PlanFactoryABI,
    functionName: "getPlan",
    args: [BigInt(planId)],
  })) as {
    id?: bigint;
    provider?: string;
    name?: string;
    tier?: string;
    price?: bigint;
    billingInterval?: number;
    acceptedToken?: string;
    active?: boolean;
    [index: number]: unknown;
  };

  return {
    id: BigInt((raw.id ?? raw[0] ?? 0n) as bigint),
    provider: String(raw.provider ?? raw[1] ?? ""),
    name: String(raw.name ?? raw[2] ?? ""),
    tier: String(raw.tier ?? raw[3] ?? ""),
    price: BigInt((raw.price ?? raw[4] ?? 0n) as bigint),
    billingInterval: Number(raw.billingInterval ?? raw[5] ?? 0),
    acceptedToken: String(raw.acceptedToken ?? raw[6] ?? ""),
    active: Boolean(raw.active ?? raw[7] ?? false),
  };
}

async function ensurePlatformBillingPlanRow(tier: PlatformTier) {
  if (tier === "FREE") return null;
  const { amountMicros } = tierPricing(tier);
  const planName = tierPlanName(tier);
  const acceptedToken = platformBillingToken();
  const treasuryWallet = platformBillingTreasury();
  const account = await db.platformBillingAccount.findFirst({
    where: { environment: { chainId: PLATFORM_BILLING_CHAIN_ID } },
    select: { environmentId: true },
  });
  if (!account) throw new Error("No platform billing environment is configured for this chain.");

  return db.platformBillingPlan.upsert({
    where: {
      environmentId_chainId_tier: {
        environmentId: account.environmentId,
        chainId: PLATFORM_BILLING_CHAIN_ID,
        tier,
      },
    },
    update: {
      planName,
      priceMicros: amountMicros,
      billingIntervalSeconds: PLATFORM_BILLING_INTERVAL_SECONDS,
      acceptedToken,
      treasuryWallet,
    },
create: {
       environmentId: account.environmentId,
       chainId: PLATFORM_BILLING_CHAIN_ID,
       chainFamily: resolveChainFamilyForPrisma(PLATFORM_BILLING_CHAIN_ID),
       tier,
       planName,
       priceMicros: amountMicros,
       billingIntervalSeconds: PLATFORM_BILLING_INTERVAL_SECONDS,
       acceptedToken,
       treasuryWallet,
       syncStatus: "PENDING",
     },
  });
}

export async function bootstrapPlatformBillingPlans(): Promise<{
  chainId: number;
  plans: Array<{
    tier: PlatformTier;
    onChainPlanId: string | null;
    syncStatus: string;
    txHash: string | null;
  }>;
}> {
  const { publicClient, walletClient } = platformWalletClient();
  const contracts = getContractAddresses(PLATFORM_BILLING_CHAIN_ID);
  const planFactoryAddress = normalizeAddress(contracts.planFactory);
  if (!planFactoryAddress) {
    throw new Error(`PlanFactory is not configured for chain ${PLATFORM_BILLING_CHAIN_ID}.`);
  }

  const acceptedToken = platformBillingToken();
  // Note: The PlanFactory contract will revert createPlan if the token is not accepted.
  // We do not perform a pre-check here since approvedTokens is not in the ABI.


  const results: Array<{
    tier: PlatformTier;
    onChainPlanId: string | null;
    syncStatus: string;
    txHash: string | null;
  }> = [];

  for (const tier of PLATFORM_BILLING_TIERS) {
    const row = await ensurePlatformBillingPlanRow(tier);
    if (!row) continue;

    if (row.onChainPlanId) {
      const onChain = await readOnChainPlatformPlan(row.onChainPlanId);
      const mismatches = [
        onChain.provider.toLowerCase() !== row.treasuryWallet.toLowerCase()
          ? "provider"
          : null,
        onChain.price !== BigInt(row.priceMicros) ? "price" : null,
        onChain.billingInterval !== row.billingIntervalSeconds
          ? "billingInterval"
          : null,
        onChain.acceptedToken.toLowerCase() !== row.acceptedToken.toLowerCase()
          ? "acceptedToken"
          : null,
        !onChain.active ? "active" : null,
      ].filter(Boolean);

      if (mismatches.length > 0) {
        await db.platformBillingPlan.update({
          where: { id: row.id },
          data: {
            syncStatus: "FAILED",
            syncError: `Existing on-chain plan mismatch: ${mismatches.join(", ")}`,
          },
        });
        throw new Error(`Platform ${tier} plan mismatch: ${mismatches.join(", ")}`);
      }

      await db.platformBillingPlan.update({
        where: { id: row.id },
        data: { syncStatus: "SYNCED", syncError: null, syncedAt: new Date() },
      });
      results.push({
        tier,
        onChainPlanId: row.onChainPlanId,
        syncStatus: "SYNCED",
        txHash: row.bootstrapTxHash,
      });
      continue;
    }

    const txHash = await walletClient.writeContract({
      address: planFactoryAddress,
      abi: PlanFactoryABI,
      functionName: "createPlan",
      args: [
        row.planName,
        tier === "PRO" ? "enterprise" : "pro",
        BigInt(row.priceMicros),
        row.billingIntervalSeconds,
        row.acceptedToken as `0x${string}`,
        `platform-tier:${tier.toLowerCase()}`,
      ],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      await db.platformBillingPlan.update({
        where: { id: row.id },
        data: {
          syncStatus: "FAILED",
          syncError: "PlanFactory.createPlan transaction failed.",
          bootstrapTxHash: txHash,
        },
      });
      throw new Error(`Failed to bootstrap ${tier} platform billing plan.`);
    }

    const logs = parseEventLogs({
      abi: PlanFactoryABI,
      logs: receipt.logs,
      eventName: "PlanCreated",
      strict: false,
    });
    const latest = [...logs].reverse().find((log) => {
      const args = log.args as { provider?: string; planId?: bigint } | undefined;
      return args?.provider?.toLowerCase() === row.treasuryWallet.toLowerCase();
    });
    const onChainPlanId = latest
      ? String((latest.args as { planId?: bigint }).planId)
      : null;
    if (!onChainPlanId) {
      throw new Error(`Could not resolve bootstrapped ${tier} plan id from logs.`);
    }

    await db.platformBillingPlan.update({
      where: { id: row.id },
      data: {
        onChainPlanId,
        bootstrapTxHash: txHash,
        syncStatus: "SYNCED",
        syncError: null,
        syncedAt: new Date(),
      },
    });

    // Sync onChainPlanId to all matching CatalogPlan entries
    const planName = tierPlanName(tier);
    await db.catalogPlan.updateMany({
      where: {
        name: planName,
        active: true,
        chainSyncStatus: { not: "SYNCED" },
      },
      data: {
        onChainPlanId,
        chainId: PLATFORM_BILLING_CHAIN_ID,
        chainFamily: resolveChainFamilyForPrisma(PLATFORM_BILLING_CHAIN_ID),
        chainSyncStatus: "SYNCED",
        acceptedToken: platformBillingToken(),
      },
    });

    results.push({ tier, onChainPlanId, syncStatus: "SYNCED", txHash });
  }

  return { chainId: PLATFORM_BILLING_CHAIN_ID, plans: results };
}

export async function getPlatformBillingPlans() {
  await Promise.all(PLATFORM_BILLING_TIERS.map((tier) => ensurePlatformBillingPlanRow(tier)));
  return db.platformBillingPlan.findMany({
    where: { chainId: PLATFORM_BILLING_CHAIN_ID },
    orderBy: { tier: "asc" },
  });
}

export async function preparePlatformTierActivation(input: {
  targetTier: PlatformTier;
  paymentAccount: string;
}): Promise<{
  chainId: number;
  targetTier: PlatformTier;
  paymentAccount: `0x${string}`;
  onChainPlanId: string;
  chargeAmountAtomic: string;
  acceptedToken: `0x${string}`;
  merchantAddress: `0x${string}`;
  autopayAddress: `0x${string}`;
  autopayStartTime: number;
  autopaySetupMode: "install" | "update";
  preparedTransactions: {
    install: { target: `0x${string}`; data: `0x${string}`; value: "0" };
    approve: { target: `0x${string}`; data: `0x${string}`; value: "0" };
    execute: { target: `0x${string}`; data: `0x${string}`; value: "0" };
  };
}> {
  if (input.targetTier === "FREE") {
    throw new Error("FREE tier does not require activation.");
  }
  const paymentAccount = normalizeAddress(input.paymentAccount);
  if (!paymentAccount) throw new Error("paymentAccount must be a valid EVM address.");

  const plan = await ensurePlatformBillingPlanRow(input.targetTier);
  if (!plan?.onChainPlanId || plan.syncStatus !== "SYNCED") {
    throw new Error("Platform billing plan is not bootstrapped yet.");
  }

  const contracts = getContractAddresses(PLATFORM_BILLING_CHAIN_ID);
  const autopayAddress = normalizeAddress(contracts.autopayModule);
  if (!autopayAddress) {
    throw new Error("AutopayModule is not configured for Arc testnet.");
  }

  const chargeAmount = BigInt(plan.priceMicros);
  const autopayStartTime = Math.floor(Date.now() / 1000) + 30;
  const config = {
    merchant: plan.treasuryWallet as `0x${string}`,
    maxAmount: chargeAmount,
    token: plan.acceptedToken as `0x${string}`,
    interval: plan.billingIntervalSeconds,
    startTime: BigInt(autopayStartTime),
    planId: BigInt(plan.onChainPlanId),
    maxTotalAmount: 0n,
  };

  const encodedConfig = encodeAbiParameters(
    [
      {
        name: "config",
        type: "tuple",
        components: [
          { name: "merchant", type: "address" },
          { name: "maxAmount", type: "uint256" },
          { name: "token", type: "address" },
          { name: "interval", type: "uint32" },
          { name: "startTime", type: "uint64" },
          { name: "planId", type: "uint256" },
          { name: "maxTotalAmount", type: "uint256" },
        ],
      },
    ],
    [config],
  );
  const isAutopayInitialized = Boolean(await platformClients(
    PLATFORM_BILLING_CHAIN_ID,
  ).publicClient.readContract({
    address: autopayAddress,
    abi: ERC7579AutopayModuleABI,
    functionName: "isInitialized",
    args: [paymentAccount],
  }));

  return {
    chainId: PLATFORM_BILLING_CHAIN_ID,
    targetTier: input.targetTier,
    paymentAccount,
    onChainPlanId: plan.onChainPlanId,
    chargeAmountAtomic: chargeAmount.toString(),
    acceptedToken: plan.acceptedToken as `0x${string}`,
    merchantAddress: plan.treasuryWallet as `0x${string}`,
    autopayAddress,
    autopayStartTime,
    autopaySetupMode: isAutopayInitialized ? "update" : "install",
    preparedTransactions: {
      install: {
        target: autopayAddress,
        data: isAutopayInitialized
          ? encodeFunctionData({
              abi: ERC7579AutopayModuleABI,
              functionName: "updateConfig",
              args: [config],
            })
          : encodeFunctionData({
              abi: ERC7579AutopayModuleABI,
              functionName: "onInstall",
              args: [encodedConfig],
            }),
        value: "0",
      },
      approve: {
        target: plan.acceptedToken as `0x${string}`,
        data: encodeFunctionData({
          abi: [
            {
              type: "function",
              name: "approve",
              inputs: [
                { name: "spender", type: "address" },
                { name: "amount", type: "uint256" },
              ],
              outputs: [{ name: "", type: "bool" }],
              stateMutability: "nonpayable",
            },
          ],
          functionName: "approve",
          args: [autopayAddress, chargeAmount * 13n],
        }),
        value: "0",
      },
      execute: {
        target: autopayAddress,
        data: encodeFunctionData({
          abi: ERC7579AutopayModuleABI,
          functionName: "execute",
          args: [paymentAccount, chargeAmount],
        }),
        value: "0",
      },
    },
  };
}

export async function ensurePlatformSubscriptionCompany(
  teamId: string,
  walletAddress?: string,
) {
  let company = await db.arcenCompany.findFirst({
    where: {
      teamId,
      traits: {
        path: [PLATFORM_TIER_COMPANY_KEY],
        equals: toPrismaJson(true),
      },
    },
  });

  if (!company) {
    company = await db.arcenCompany.create({
      data: {
        teamId,
        name: "ArcenPay Platform",
        walletAddress: walletAddress ?? null,
        traits: toPrismaJson({ [PLATFORM_TIER_COMPANY_KEY]: true }),
      },
    });
  }

  return company;
}

const PLATFORM_TIER_FEATURES: Record<PlatformTier, string[]> = {
  FREE: [
    "Dapps / Applications linked: 1",
    "Webhooks: 1 endpoint (all events, HMAC-SHA256 signed)",
    "Payment links: Up to 3 active links",
    "SDK access: 1 API key (Node + React SDK)",
    "Plans: Up to 3 active plans",
    "Subscribers: Up to 200",
    "Chains: 1 chain",
    "Environments: 2 dev + 2 prod",
    "Team members: 3",
    "Feature flags: 5 (boolean only)",
    "Billing intervals: Monthly only",
    "ZK settlement (ZKVUB): Yes",
    "Agent payments (x402): Yes",
    "Support: Community",
    "Platform fee: 2.0%",
  ],
  PLUS: [
    "Dapps / Applications linked: 10",
    "Webhooks: Unlimited endpoints (per-event preferences)",
    "Payment links: Up to 50 active links",
    "SDK access: Multiple API keys",
    "Plans: Up to 15 active plans",
    "Subscribers: Up to 50,000",
    "Chains: Unlimited",
    "Environments: 10 dev + 10 prod",
    "Team members: 10",
    "Feature flags: 999 (all types)",
    "Billing intervals: Monthly + Annual",
    "ZK settlement (ZKVUB): Yes",
    "Agent payments (x402): Yes",
    "Coupons: Up to 10 active coupons",
    "Add-ons: Up to 10 active add-ons",
    "Credit types: Up to 5 active credit types",
    "Usage metering & credit-burn: Yes",
    "Custom branding: Yes",
    "Invoice builder: Yes",
    "ISO 20022 export: Yes",
    "Support: Priority email",
    "Platform fee: 1.0%",
  ],
  PRO: [
    "Dapps / Applications linked: Unlimited",
    "Webhooks: Unlimited endpoints",
    "Payment links: Unlimited",
    "SDK access: Unlimited keys + Agent SDK",
    "Plans: Unlimited",
    "Subscribers: Unlimited",
    "Chains: Unlimited",
    "Environments: Unlimited",
    "Team members: Unlimited",
    "Feature flags: Unlimited (all types)",
    "Coupons: Unlimited",
    "Add-ons: Unlimited",
    "Credit types: Unlimited",
  "Usage metering & credit-burn: Yes",
  "Custom branding: Full whitelabel",
  "Invoice builder: Full whitelabel",
  "Agent payments (x402 protocol): Yes",
  "ZK settlement (ZKVUB): Yes",
  "Support: Dedicated support",
  "Platform fee: 0.5%",
  ],
};

export function buildPlatformTierEntitlements(tier: PlatformTier): Array<{
  featureKey: string;
  featureName: string;
  type: "BOOLEAN";
  value: boolean;
  enabled: boolean;
  icon: string;
}> {
  const features = PLATFORM_TIER_FEATURES[tier];

  function resolveIcon(text: string): string {
    if (text.startsWith("Dapps") || text.startsWith("Dapps / Applications")) return "lucide:layers";
    if (text.startsWith("Webhooks")) return "lucide:webhook";
    if (text.startsWith("Payment links")) return "lucide:link";
    if (text.startsWith("SDK access")) return "lucide:key";
    if (text.startsWith("Plans:")) return "lucide:clipboard-list";
    if (text.startsWith("Subscribers")) return "lucide:users";
    if (text.startsWith("Chains")) return "lucide:git-branch";
    if (text.startsWith("Environments")) return "lucide:container";
    if (text.startsWith("Team members")) return "lucide:user-plus";
    if (text.startsWith("Feature flags")) return "lucide:flag";
    if (text.startsWith("Billing intervals")) return "lucide:calendar";
    if (text.startsWith("ZK settlement")) return "lucide:shield-check";
    if (text.startsWith("Agent payments")) return "lucide:bot";
    if (text.startsWith("Add-ons")) return "lucide:puzzle";
    if (text.startsWith("Credit types")) return "lucide:coins";
    if (text.startsWith("Coupons")) return "lucide:ticket";
    if (text.startsWith("Usage metering")) return "lucide:gauge";
    if (text.startsWith("Custom branding")) return "lucide:palette";
    if (text.startsWith("Invoice builder")) return "lucide:file-pen";
    if (text.startsWith("ISO 20022")) return "lucide:file-text";
    if (text.startsWith("Cross-chain")) return "lucide:arrow-left-right";
    if (text.startsWith("Tableland")) return "lucide:database";
    if (text.startsWith("Support")) return "lucide:headphones";
    if (text.startsWith("Platform fee")) return "lucide:percent";
    return "lucide:check";
  }

  return features.map((featureText, idx) => ({
    featureKey: `platform_tier_feat_${idx}`,
    featureName: featureText,
    type: "BOOLEAN" as const,
    value: true,
    enabled: true,
    icon: resolveIcon(featureText),
  }));
}

export async function ensureTierCatalogPlan(
  teamId: string,
  tier: PlatformTier,
  options: {
    environmentId?: string | null;
    publish?: boolean;
    syncOnchain?: boolean;
  } = {},
): Promise<string | null> {
  const cacheKey = `${teamId}:${options.environmentId ?? "legacy"}:${tier}`;
  if (TIER_PLAN_IDS[cacheKey]) return TIER_PLAN_IDS[cacheKey];

  const planName = `ArcenPay ${tier === "PRO" ? "Enterprise" : tier === "PLUS" ? "Pro" : "Free"} Plan`;
  const { priceUsdPerMonth } = tierPricing(tier);
  const annualPrice =
    tier === "FREE" ? "0" : String(Math.round(priceUsdPerMonth * 12 * 0.8));

  const billingCustomerEnvironment = options.environmentId
    ? null
    : await db.platformBillingCustomer.findUnique({
        where: { workspaceTeamId: teamId },
        select: { environmentId: true },
      });
  const resolvedEnvironmentId =
    options.environmentId ?? billingCustomerEnvironment?.environmentId ?? null;

  const environment = resolvedEnvironmentId
    ? await db.workspaceEnvironment.findUnique({
        where: { id: resolvedEnvironmentId },
        select: { mode: true, chainId: true },
      })
    : null;
  const catalogChainId = environment?.chainId ?? PLATFORM_BILLING_CHAIN_ID;
  const catalogToken =
    normalizeAddress(getTokenAddress(catalogChainId, "USDC")) ??
    platformBillingToken();

  const expectedCatalogTier =
    tier === "PRO" ? "enterprise" : tier === "PLUS" ? "pro" : "starter";
  const candidatePlans = await db.catalogPlan.findMany({
    where: {
      teamId,
      active: true,
      tier: expectedCatalogTier,
      ...(resolvedEnvironmentId ? { environmentId: resolvedEnvironmentId } : {}),
    },
    select: { id: true, onChainPlanId: true },
    orderBy: { createdAt: "asc" },
  });
  // Reuse the existing live/on-chain plan before considering a draft. This
  // prevents automatic enrollment from creating a second plan just because
  // the administrator chose a different display name such as "Pro".
  let plan =
    candidatePlans.find((candidate) => candidate.onChainPlanId) ??
    candidatePlans[0] ??
    null;

  const entitlements = buildPlatformTierEntitlements(tier);
  const metadata = {
    isPlatformTierPlan: true,
    tier,
    entitlements,
  };

  if (!plan) {
    plan = await db.catalogPlan.create({
      data: {
        teamId,
        name: planName,
        tier: tier === "PRO" ? "enterprise" : tier === "PLUS" ? "pro" : "starter",
        description: `ArcenPay platform ${tier} tier subscription`,
        status: options.publish === false ? "DRAFT" : "PUBLISHED",
        publishedAt: options.publish === false ? null : new Date(),
        active: true,
        environmentId: resolvedEnvironmentId ?? undefined,
        price: tier === "FREE" ? "0" : String(priceUsdPerMonth),
        annualPrice,
        billingInterval: MONTHLY_INTERVAL,
        environmentMode: environment?.mode ?? "DEVELOPMENT",
        chainId: catalogChainId,
        chainFamily: resolveChainFamilyForPrisma(catalogChainId),
        acceptedToken: catalogToken,
        metadata: toPrismaJson(metadata),
      },
      select: { id: true, onChainPlanId: true },
    });
  } else {
    await db.catalogPlan.update({
      where: { id: plan.id },
      data: {
        metadata: toPrismaJson(metadata),
        price: tier === "FREE" ? "0" : String(priceUsdPerMonth),
        annualPrice,
        ...(!plan.onChainPlanId
          ? {
              environmentMode: environment?.mode ?? "DEVELOPMENT",
              chainId: catalogChainId,
              chainFamily: resolveChainFamilyForPrisma(catalogChainId),
              acceptedToken: catalogToken,
            }
          : {}),
        ...(options.publish === false
          ? { status: "DRAFT" as const, publishedAt: null }
          : {}),
      },
    });
  }

  if (entitlements.length > 0) {
    await syncEntitlementsToFlagRules(teamId, plan.id, entitlements);
  }

  // Sync onChainPlanId from bootstrapped platform billing plan
  if (tier !== "FREE" && options.syncOnchain !== false) {
    const onChainPlan = await db.platformBillingPlan.findFirst({
      where: {
        chainId: PLATFORM_BILLING_CHAIN_ID,
        tier,
        syncStatus: "SYNCED",
      },
      select: { onChainPlanId: true },
    });

    if (onChainPlan?.onChainPlanId) {
      await db.catalogPlan.update({
        where: { id: plan.id },
        data: {
          onChainPlanId: onChainPlan.onChainPlanId,
          chainId: PLATFORM_BILLING_CHAIN_ID,
          chainSyncStatus: "SYNCED",
          acceptedToken: platformBillingToken(),
        },
      });
    }
  }

  TIER_PLAN_IDS[cacheKey] = plan.id;
  return plan.id;
}

// ── On-chain tx verification helper ─────────────────────────────────────────

async function verifyAutopayExecuteTx(input: {
  txHash: string;
  paymentAccount: string;
  expectedChainId: number;
  expectedAutopayAddress: string;
  expectedAmountMicros: number;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { txHash, paymentAccount, expectedChainId, expectedAutopayAddress, expectedAmountMicros } = input;

  const { publicClient } = platformClients(expectedChainId);

  let receipt: Awaited<ReturnType<typeof publicClient.getTransactionReceipt>>;
  let tx: Awaited<ReturnType<typeof publicClient.getTransaction>>;
  try {
    [receipt, tx] = await Promise.all([
      publicClient.getTransactionReceipt({ hash: txHash as `0x${string}` }),
      publicClient.getTransaction({ hash: txHash as `0x${string}` }),
    ]);
  } catch (e) {
    return { ok: false, reason: `Cannot fetch tx from chain: ${String(e)}` };
  }

  if (receipt.status !== "success") {
    return { ok: false, reason: "Transaction reverted on-chain." };
  }

  // Verify the tx was sent TO the autopay module
  const txTo = (tx.to ?? "").toLowerCase();
  const expectedTo = expectedAutopayAddress.toLowerCase();
  if (txTo !== expectedTo) {
    return {
      ok: false,
      reason: `Tx was sent to ${tx.to}, expected AutopayModule at ${expectedAutopayAddress}.`,
    };
  }

  // Decode the `execute(address account, uint256 amount)` calldata
  let decodedAccount: string;
  let decodedAmount: bigint;
  try {
    const decoded = decodeFunctionData({
      abi: ERC7579AutopayModuleABI,
      data: tx.input,
    });
    if (decoded.functionName !== "execute") {
      return { ok: false, reason: `Expected execute() call, got ${decoded.functionName}.` };
    }
    const args = decoded.args as [string, bigint];
    decodedAccount = args[0];
    decodedAmount = args[1];
  } catch (e) {
    return { ok: false, reason: `Failed to decode calldata: ${String(e)}` };
  }

  // Verify account matches paymentAccount
  if (decodedAccount.toLowerCase() !== paymentAccount.toLowerCase()) {
    return {
      ok: false,
      reason: `Decoded account ${decodedAccount} does not match paymentAccount ${paymentAccount}.`,
    };
  }

  // Verify amount matches plan price (allow 1 unit tolerance for rounding)
  const expectedAmount = BigInt(expectedAmountMicros);
  if (decodedAmount < expectedAmount || decodedAmount > expectedAmount + 1n) {
    return {
      ok: false,
      reason: `Decoded amount ${decodedAmount} does not match expected ${expectedAmount}.`,
    };
  }

  return { ok: true };
}

export async function confirmPlatformTierActivation(input: {
  teamId: string;
  targetTier: PlatformTier;
  paymentAccount: string;
  txHash: string;
}): Promise<{
  ok: boolean;
  subscriptionStateId: string | null;
  invoiceId: string | null;
  paymentId: string | null;
  deduped: boolean;
  error?: string;
}> {
  const { teamId, targetTier, paymentAccount, txHash } = input;

  if (targetTier === "FREE") {
    return { ok: false, subscriptionStateId: null, invoiceId: null, paymentId: null, deduped: false, error: "FREE tier does not require on-chain activation." };
  }

  const normalizedPaymentAccount = normalizeAddress(paymentAccount);
  if (!normalizedPaymentAccount) {
    return { ok: false, subscriptionStateId: null, invoiceId: null, paymentId: null, deduped: false, error: "paymentAccount must be a valid EVM address." };
  }

  if (!txHash || !txHash.startsWith("0x")) {
    return { ok: false, subscriptionStateId: null, invoiceId: null, paymentId: null, deduped: false, error: "txHash must be a valid hex transaction hash." };
  }

  // Fetch the on-chain plan row
  const plan = await db.platformBillingPlan.findUnique({
    where: {
      environmentId_chainId_tier: {
        environmentId: (await db.platformBillingAccount.findFirstOrThrow({
          where: { environment: { chainId: PLATFORM_BILLING_CHAIN_ID } },
          select: { environmentId: true },
        })).environmentId,
        chainId: PLATFORM_BILLING_CHAIN_ID,
        tier: targetTier,
      },
    },
  });

  if (!plan?.onChainPlanId || plan.syncStatus !== "SYNCED") {
    return { ok: false, subscriptionStateId: null, invoiceId: null, paymentId: null, deduped: false, error: "Platform billing plan is not bootstrapped yet. Run bootstrap first." };
  }

  const contracts = getContractAddresses(PLATFORM_BILLING_CHAIN_ID);
  const autopayAddress = normalizeAddress(contracts.autopayModule);
  if (!autopayAddress) {
    return { ok: false, subscriptionStateId: null, invoiceId: null, paymentId: null, deduped: false, error: "AutopayModule not configured for platform billing chain." };
  }

  // Build the idempotency key using the full 4-arg version
  const idempotencyKey = buildTierIdempotencyKey(teamId, targetTier, normalizedPaymentAccount, txHash);

  // Idempotency check: if a payment with this key already exists, return success
  const existingPayment = await db.payment.findUnique({
    where: { idempotencyKey },
    select: { id: true, invoiceId: true },
  });

  if (existingPayment) {
    const existingSub = await db.subscriptionState.findFirst({
      where: { teamId, company: { traits: { path: [PLATFORM_TIER_COMPANY_KEY], equals: toPrismaJson(true) } }, status: "ACTIVE" },
      select: { id: true },
    });
    return {
      ok: true,
      deduped: true,
      subscriptionStateId: existingSub?.id ?? null,
      invoiceId: existingPayment.invoiceId ?? null,
      paymentId: existingPayment.id,
    };
  }

  // Also check for duplicate txHash across all payments
  const existingByTxHash = await db.payment.findUnique({
    where: { txHash: txHash.toLowerCase() },
    select: { id: true, invoiceId: true },
  });
  if (existingByTxHash) {
    return { ok: false, subscriptionStateId: null, invoiceId: null, paymentId: null, deduped: true, error: "txHash already recorded for a different payment." };
  }

  // Verify the transaction on-chain
  const verification = await verifyAutopayExecuteTx({
    txHash,
    paymentAccount: normalizedPaymentAccount,
    expectedChainId: PLATFORM_BILLING_CHAIN_ID,
    expectedAutopayAddress: autopayAddress,
    expectedAmountMicros: plan.priceMicros,
  });

  if (!verification.ok) {
    return {
      ok: false,
      subscriptionStateId: null,
      invoiceId: null,
      paymentId: null,
      deduped: false,
      error: verification.reason,
    };
  }

  // All verified — record the billing state
  const result = await activateTeamPlatformTier({
    teamId,
    targetTier,
    walletAddress: normalizedPaymentAccount,
    txHash,
    paymentAccount: normalizedPaymentAccount,
  });

  return {
    ok: result.ok,
    subscriptionStateId: result.subscriptionStateId,
    invoiceId: result.invoiceId,
    paymentId: result.paymentId,
    deduped: false,
    error: result.error,
  };
}

export async function activateTeamPlatformTier(input: {
  teamId: string;
  targetTier: PlatformTier;
  walletAddress?: string;
  txHash?: string;
  paymentAccount?: string;  // required for proper idempotency key on paid tiers
}): Promise<{
  ok: boolean;
  subscriptionStateId: string | null;
  invoiceId: string | null;
  paymentId: string | null;
  error?: string;
}> {
  const { teamId, targetTier, walletAddress, txHash, paymentAccount } = input;
  if (targetTier === "FREE") {
    return { ok: true, subscriptionStateId: null, invoiceId: null, paymentId: null };
  }

  const { priceUsdPerMonth } = tierPricing(targetTier);

  // Use proper 4-arg idempotency key when paymentAccount and txHash are available,
  // otherwise fall back to a simpler key for legacy/downgrade flows.
  const effectivePaymentAccount = paymentAccount ?? walletAddress ?? "unknown";
  const effectiveTxHash = txHash ?? "no-tx";
  const idempotencyKey = buildTierIdempotencyKey(teamId, targetTier, effectivePaymentAccount, effectiveTxHash);

  const existing = await db.subscriptionState.findFirst({
    where: {
      teamId,
      company: { traits: { path: [PLATFORM_TIER_COMPANY_KEY], equals: toPrismaJson(true) } },
      status: "ACTIVE",
    },
    select: { id: true },
  });

  if (existing) {
    return {
      ok: true,
      subscriptionStateId: existing.id,
      invoiceId: null,
      paymentId: null,
    };
  }

  const company = await ensurePlatformSubscriptionCompany(teamId, walletAddress);
  const catalogPlanId = await ensureTierCatalogPlan(teamId, targetTier);

  if (!catalogPlanId) {
    return {
      ok: false,
      subscriptionStateId: null,
      invoiceId: null,
      paymentId: null,
      error: "Failed to ensure tier catalog plan",
    };
  }

  // Look up team owner email for invoice + receipt delivery
  const teamOwner = await db.teamMember.findFirst({
    where: { teamId, role: "OWNER" },
    include: { user: { select: { email: true } } },
  });
  const ownerEmail = teamOwner?.user?.email ?? null;

  const now = new Date();
  const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const invoiceNumber = await allocateInvoiceNumber(teamId, "AP", now);

  const invoice = await db.invoice.create({
    data: {
      teamId,
      number: invoiceNumber,
      status: "PAID",
      currency: "USDC",
      customerEmail: ownerEmail,
      subtotal: toSix(priceUsdPerMonth),
      total: toSix(priceUsdPerMonth),
      amountPaid: toSix(priceUsdPerMonth),
      amountOutstanding: "0.000000",
      planId: catalogPlanId,
      companyId: company.id,
      issuedAt: now,
      paidAt: now,
      metadata: toPrismaJson({
        source: "platform-tier-activation",
        tier: targetTier,
        txHash: txHash ?? null,
      }),
      lineItems: {
        create: {
          description: `ArcenPay ${targetTier} Tier — Monthly Subscription`,
          quantity: 1,
          unitAmount: toSix(priceUsdPerMonth),
          lineSubtotal: toSix(priceUsdPerMonth),
          lineTotal: toSix(priceUsdPerMonth),
          metadata: toPrismaJson({ tier: targetTier }),
        },
      },
    },
    select: { id: true },
  });

  const payment = await recordSuccessfulPayment({
    idempotencyKey,
    teamId,
    companyId: company.id,
    invoiceId: invoice.id,
    kind: "SUBSCRIPTION_ACTIVATION",
    amount: priceUsdPerMonth,
    currency: "USDC",
    txHash: txHash ?? null,
    occurredAt: now,
    settledAt: now,
    metadata: { source: "platform-tier-activation", tier: targetTier },
  });

  const subscriptionState = await upsertSubscriptionLedgerState({
    teamId,
    companyId: company.id,
    status: "ACTIVE",
    catalogPlanId,
    walletAddress: walletAddress ?? company.walletAddress,
    currentPeriodStart: now,
    currentPeriodEnd: periodEnd,
    lastEvent: "platform.tier.activated",
    lastEventAt: now,
    lastSourceTxHash: txHash ?? null,
    metadata: {
      source: "platform-tier-activation",
      tier: targetTier,
      isPlatformSubscription: true,
    },
  });

  if (subscriptionState) {
    await db.team.update({
      where: { id: teamId },
      data: {
        platformTier: targetTier,
        tierSubscriptionId: subscriptionState.id,
        tierExpiresAt: periodEnd,
      },
    });
  }

  deliverWebhook(teamId, "platform.tier.activated", {
    teamId,
    tier: targetTier,
    subscriptionStateId: subscriptionState?.id ?? null,
    invoiceId: invoice.id,
    paymentId: payment.id,
    effectiveAt: now.toISOString(),
  }).catch((err) => {
    console.warn("[platform-tier-billing] Failed to deliver activation webhook:", err);
  });

  // Fire-and-forget: send invoice + receipt email to team owner
  sendPaidInvoiceReceipt({
    teamId,
    invoiceId: invoice.id,
    txHash: txHash ?? null,
  }).catch((err) => {
    console.warn("[platform-tier-billing] Failed to send invoice receipt email:", err);
  });

  return {
    ok: true,
    subscriptionStateId: subscriptionState?.id ?? null,
    invoiceId: invoice.id,
    paymentId: payment.id,
  };
}

export async function renewTeamPlatformTier(input: {
  teamId: string;
  now?: Date;
}): Promise<{
  ok: boolean;
  renewed: boolean;
  subscriptionStateId: string | null;
  error?: string;
}> {
  const { teamId } = input;
  const now = input.now ?? new Date();

  const team = await db.team.findUnique({
    where: { id: teamId },
    select: {
      platformTier: true,
      tierExpiresAt: true,
      tierSubscriptionId: true,
    },
  });

  if (!team || team.platformTier === "FREE" || !team.tierSubscriptionId) {
    return { ok: true, renewed: false, subscriptionStateId: null };
  }

  const subscriptionState = await db.subscriptionState.findUnique({
    where: { id: team.tierSubscriptionId },
    select: { id: true, status: true, currentPeriodEnd: true, catalogPlanId: true },
  });

  if (!subscriptionState || subscriptionState.status === "CANCELLED") {
    return { ok: true, renewed: false, subscriptionStateId: null };
  }

  if (subscriptionState.currentPeriodEnd && subscriptionState.currentPeriodEnd > now) {
    return {
      ok: true,
      renewed: false,
      subscriptionStateId: subscriptionState.id,
    };
  }

  const { priceUsdPerMonth } = tierPricing(team.platformTier);
  const idempotencyKey = buildTierRenewalIdempotencyKey(
    teamId,
    team.platformTier,
    subscriptionState.currentPeriodEnd ?? now,
  );

  const existingPayment = await db.payment.findUnique({
    where: { idempotencyKey },
    select: { id: true },
  });

  if (existingPayment) {
    return {
      ok: true,
      renewed: false,
      subscriptionStateId: subscriptionState.id,
    };
  }

  const company = await ensurePlatformSubscriptionCompany(teamId);
  const planId = subscriptionState.catalogPlanId ?? (await ensureTierCatalogPlan(teamId, team.platformTier));

  if (!planId) {
    return {
      ok: false,
      renewed: false,
      subscriptionStateId: subscriptionState.id,
      error: "Missing tier catalog plan",
    };
  }

  // Look up team owner email for invoice + receipt delivery
  const teamOwner = await db.teamMember.findFirst({
    where: { teamId, role: "OWNER" },
    include: { user: { select: { email: true } } },
  });
  const ownerEmail = teamOwner?.user?.email ?? null;

  const periodStart = subscriptionState.currentPeriodEnd ?? now;
  const periodEnd = new Date(periodStart.getTime() + 30 * 24 * 60 * 60 * 1000);
  const invoiceNumber = await allocateInvoiceNumber(teamId, "AP", now);

  const invoice = await db.invoice.create({
    data: {
      teamId,
      number: invoiceNumber,
      status: "PAID",
      currency: "USDC",
      customerEmail: ownerEmail,
      subtotal: toSix(priceUsdPerMonth),
      total: toSix(priceUsdPerMonth),
      amountPaid: toSix(priceUsdPerMonth),
      amountOutstanding: "0.000000",
      planId,
      companyId: company.id,
      issuedAt: now,
      paidAt: now,
      metadata: toPrismaJson({
        source: "platform-tier-renewal",
        tier: team.platformTier,
      }),
      lineItems: {
        create: {
          description: `ArcenPay ${team.platformTier} Tier — Monthly Renewal`,
          quantity: 1,
          unitAmount: toSix(priceUsdPerMonth),
          lineSubtotal: toSix(priceUsdPerMonth),
          lineTotal: toSix(priceUsdPerMonth),
          metadata: toPrismaJson({ tier: team.platformTier }),
        },
      },
    },
    select: { id: true },
  });

  await recordSuccessfulPayment({
    idempotencyKey,
    teamId,
    companyId: company.id,
    invoiceId: invoice.id,
    kind: "SUBSCRIPTION_RENEWAL",
    amount: priceUsdPerMonth,
    currency: "USDC",
    occurredAt: now,
    settledAt: now,
    metadata: { source: "platform-tier-renewal", tier: team.platformTier },
  });

  await upsertSubscriptionLedgerState({
    teamId,
    companyId: company.id,
    status: "ACTIVE",
    catalogPlanId: planId,
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd,
    lastEvent: "platform.tier.renewed",
    lastEventAt: now,
    metadata: {
      source: "platform-tier-renewal",
      tier: team.platformTier,
      isPlatformSubscription: true,
    },
  });

  await db.team.update({
    where: { id: teamId },
    data: { tierExpiresAt: periodEnd },
  });

  deliverWebhook(teamId, "platform.tier.renewed", {
    teamId,
    tier: team.platformTier,
    subscriptionStateId: subscriptionState.id,
    invoiceId: invoice.id,
    effectiveAt: now.toISOString(),
    nextPeriodEnd: periodEnd.toISOString(),
  }).catch((err) => {
    console.warn("[platform-tier-billing] Failed to deliver renewal webhook:", err);
  });

  // Fire-and-forget: send invoice + receipt email to team owner
  sendPaidInvoiceReceipt({
    teamId,
    invoiceId: invoice.id,
  }).catch((err) => {
    console.warn("[platform-tier-billing] Failed to send renewal receipt email:", err);
  });

  return {
    ok: true,
    renewed: true,
    subscriptionStateId: subscriptionState.id,
  };
}

export async function cancelTeamPlatformTier(input: {
  teamId: string;
  now?: Date;
}): Promise<{ ok: boolean; error?: string }> {
  const { teamId } = input;
  const now = input.now ?? new Date();

  const team = await db.team.findUnique({
    where: { id: teamId },
    select: { tierSubscriptionId: true },
  });

  if (!team?.tierSubscriptionId) {
    return { ok: true };
  }

  const subscriptionState = await db.subscriptionState.findUnique({
    where: { id: team.tierSubscriptionId },
    select: { id: true, status: true },
  });

  if (!subscriptionState || subscriptionState.status === "CANCELLED") {
    return { ok: true };
  }

  await db.subscriptionState.update({
    where: { id: team.tierSubscriptionId },
    data: {
      status: "CANCELLED",
      cancelledAt: now,
      cancelAtPeriodEnd: false,
      lastEvent: "platform.tier.cancelled",
      lastEventAt: now,
    },
  });

  await db.team.update({
    where: { id: teamId },
    data: {
      platformTier: "FREE",
      tierExpiresAt: null,
      tierSubscriptionId: null,
    },
  });

  deliverWebhook(teamId, "platform.tier.cancelled", {
    teamId,
    effectiveAt: now.toISOString(),
  }).catch((err) => {
    console.warn("[platform-tier-billing] Failed to deliver cancellation webhook:", err);
  });

  return { ok: true };
}

export async function getTeamPlatformSubscription(teamId: string): Promise<{
  status: string | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  pastDueAt: Date | null;
  graceEndsAt: Date | null;
  tier: string | null;
  amount: number;
} | null> {
  const team = await db.team.findUnique({
    where: { id: teamId },
    select: {
      platformTier: true,
      tierExpiresAt: true,
      tierSubscriptionId: true,
    },
  });

  if (!team || !team.tierSubscriptionId) return null;

  const state = await db.subscriptionState.findUnique({
    where: { id: team.tierSubscriptionId },
    select: {
      status: true,
      currentPeriodStart: true,
      currentPeriodEnd: true,
      pastDueAt: true,
      graceEndsAt: true,
    },
  });

  if (!state) return null;

  const { priceUsdPerMonth } = tierPricing(team.platformTier);

  return {
    status: state.status,
    currentPeriodStart: state.currentPeriodStart,
    currentPeriodEnd: state.currentPeriodEnd,
    pastDueAt: state.pastDueAt,
    graceEndsAt: state.graceEndsAt,
    tier: team.platformTier,
    amount: priceUsdPerMonth,
  };
}

export async function runPlatformTierDunningSweep(options?: {
  now?: Date;
  teamId?: string;
  limit?: number;
}): Promise<{
  scanned: number;
  enforced: number;
  skipped: number;
  results: Array<{
    teamId: string;
    fromTier: string;
    subscriptionStateId: string | null;
  }>;
}> {
  const now = options?.now ?? new Date();

  const candidates = await db.subscriptionState.findMany({
    where: {
      ...(options?.teamId ? { teamId: options.teamId } : {}),
      status: "PAST_DUE",
      graceEndsAt: { lte: now },
      metadata: {
        path: ["isPlatformSubscription"],
        equals: toPrismaJson(true),
      },
    },
    orderBy: { graceEndsAt: "asc" },
    take: options?.limit ?? 50,
    select: {
      id: true,
      teamId: true,
    },
  });

  const results: Array<{
    teamId: string;
    fromTier: string;
    subscriptionStateId: string | null;
  }> = [];

  for (const state of candidates) {
    const team = await db.team.findUnique({
      where: { id: state.teamId },
      select: { platformTier: true },
    });

    if (!team || team.platformTier === "FREE") {
      results.push({
        teamId: state.teamId,
        fromTier: team?.platformTier ?? "UNKNOWN",
        subscriptionStateId: state.id,
      });
      continue;
    }

    await db.$transaction([
      db.team.update({
        where: { id: state.teamId },
        data: {
          platformTier: "FREE",
          tierExpiresAt: null,
          tierSubscriptionId: null,
        },
      }),
      db.subscriptionState.update({
        where: { id: state.id },
        data: {
          status: "CANCELLED",
          cancelledAt: now,
          lastEvent: "platform.tier.dunning_enforced",
          lastEventAt: now,
        },
      }),
    ]);

    deliverWebhook(state.teamId, "platform.tier.downgraded", {
      teamId: state.teamId,
      fromTier: team.platformTier,
      toTier: "FREE",
      reason: "dunning_enforced",
      enforcedAt: now.toISOString(),
    }).catch((err) => {
      console.warn("[platform-tier-billing] Failed to deliver dunning webhook:", err);
    });

    results.push({
      teamId: state.teamId,
      fromTier: team.platformTier,
      subscriptionStateId: state.id,
    });
  }

  return {
    scanned: candidates.length,
    enforced: results.length,
    skipped: results.filter((r) => r.subscriptionStateId === null).length,
    results,
  };
}

export async function runPlatformTierRenewalSweep(input?: {
  now?: Date;
  teamId?: string;
  limit?: number;
}): Promise<{
  scanned: number;
  renewed: number;
  failed: number;
  results: Array<{
    teamId: string;
    tier: string;
    renewed: boolean;
    error?: string;
  }>;
}> {
  const now = input?.now ?? new Date();
  const buffer = 24 * 60 * 60 * 1000;
  const cutoff = new Date(now.getTime() + buffer);

  const candidates = await db.team.findMany({
    where: {
      ...(input?.teamId ? { id: input.teamId } : {}),
      platformTier: { not: "FREE" },
      tierExpiresAt: { lte: cutoff, not: null },
    },
    orderBy: { tierExpiresAt: "asc" },
    take: input?.limit ?? 50,
    select: {
      id: true,
      platformTier: true,
    },
  });

  const results: Array<{
    teamId: string;
    tier: string;
    renewed: boolean;
    error?: string;
  }> = [];

  for (const team of candidates) {
    try {
      const result = await renewTeamPlatformTier({ teamId: team.id, now });
      results.push({
        teamId: team.id,
        tier: team.platformTier,
        renewed: result.renewed,
        error: result.error,
      });
    } catch (err) {
      results.push({
        teamId: team.id,
        tier: team.platformTier,
        renewed: false,
        error: String(err),
      });
    }
  }

  return {
    scanned: candidates.length,
    renewed: results.filter((r) => r.renewed).length,
    failed: results.filter((r) => !r.renewed && r.error).length,
    results,
  };
}

// ─── Billing Readiness ────────────────────────────────────────────────────────

export async function getTeamPlatformBillingReadiness(teamId: string): Promise<{
  readiness: PlatformBillingReadiness;
  platformPlans: Array<{
    tier: string;
    onChainPlanId: string | null;
    syncStatus: string;
    priceMicros: number;
    acceptedToken: string;
    chainId: number;
  }>;
  subscription: {
    status: string | null;
    currentPeriodEnd: Date | null;
    graceEndsAt: Date | null;
  } | null;
}> {
  // Check env config
  const hasConfig =
    Boolean(PLATFORM_BILLING_OPS_PRIVATE_KEY) &&
    Boolean(PLATFORM_BILLING_TREASURY_ADDRESS);

  if (!hasConfig) {
    return { readiness: "NOT_CONFIGURED", platformPlans: [], subscription: null };
  }

  // Load platform plan rows
  const plans = await db.platformBillingPlan.findMany({
    where: { chainId: PLATFORM_BILLING_CHAIN_ID },
    select: {
      tier: true,
      onChainPlanId: true,
      syncStatus: true,
      priceMicros: true,
      acceptedToken: true,
      chainId: true,
    },
  });

  const platformPlans = plans.map((p: typeof plans[number]) => ({
    tier: p.tier as string,
    onChainPlanId: p.onChainPlanId,
    syncStatus: p.syncStatus as string,
    priceMicros: p.priceMicros,
    acceptedToken: p.acceptedToken,
    chainId: p.chainId,
  }));

  // A platform owner may deploy the first-party Pro/Enterprise catalog plans
  // through the normal catalog flow instead of the legacy bootstrap endpoint.
  // Those plans are the authoritative portal plans, so readiness must accept
  // them when both are published, active, and have an on-chain identity.
  const platformAccount = await db.platformBillingAccount.findFirst({
    where: { environment: { chainId: PLATFORM_BILLING_CHAIN_ID } },
    select: { providerTeamId: true, environmentId: true },
  });
  const catalogPaidPlans = platformAccount
    ? await db.catalogPlan.findMany({
        where: {
          teamId: platformAccount.providerTeamId,
          environmentId: platformAccount.environmentId,
          active: true,
          status: "PUBLISHED",
          tier: { in: ["pro", "enterprise"] },
          chainId: PLATFORM_BILLING_CHAIN_ID,
          onChainPlanId: { not: null },
        },
        select: {
          tier: true,
          onChainPlanId: true,
          price: true,
          acceptedToken: true,
          chainId: true,
        },
      })
    : [];
  const hasCatalogPaidPlans =
    new Set(catalogPaidPlans.map((plan) => plan.tier)).size === 2;

  const anyFailed = plans.some((p: typeof plans[number]) => p.syncStatus === "FAILED");
  if (anyFailed && !hasCatalogPaidPlans) {
    return { readiness: "BOOTSTRAP_FAILED", platformPlans, subscription: null };
  }

  const allSynced =
    plans.length > 0 && plans.every((p: typeof plans[number]) => p.syncStatus === "SYNCED" && p.onChainPlanId);

  if (!allSynced && !hasCatalogPaidPlans) {
    return { readiness: "BOOTSTRAP_MISSING", platformPlans, subscription: null };
  }

  // Check existing subscription
  const team = await db.team.findUnique({
    where: { id: teamId },
    select: { platformTier: true, tierSubscriptionId: true },
  });

  if (!team || team.platformTier === "FREE" || !team.tierSubscriptionId) {
    return { readiness: "READY", platformPlans, subscription: null };
  }

  const state = await db.subscriptionState.findUnique({
    where: { id: team.tierSubscriptionId },
    select: { status: true, currentPeriodEnd: true, graceEndsAt: true },
  });

  if (!state) {
    return { readiness: "READY", platformPlans, subscription: null };
  }

  const subscription = {
    status: state.status as string,
    currentPeriodEnd: state.currentPeriodEnd,
    graceEndsAt: state.graceEndsAt,
  };

  if (state.status === "PAST_DUE") {
    return { readiness: "PAST_DUE", platformPlans, subscription };
  }

  return { readiness: "ACTIVE", platformPlans, subscription };
}
