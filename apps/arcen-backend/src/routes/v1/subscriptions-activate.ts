/**
 * POST /api/v1/subscriptions/activate
 *
 * Execute the first authorized on-chain subscription activation through the
 * provider's configured merchant signer.
 *
 * Auth:
 *   - Bearer api_xxx (recommended for provider backends)
 *   - Dashboard session cookie
 *
 * Body:
 * {
 *   planId: string | number,      // on-chain PlanFactory plan ID
 *   paymentAccount: string,       // subscriber EOA or smart account
 *   company: { id?, wallet?, email?, name?, traits? },
 *   subscriberEmail?: string
 * }
 */

import type { Context } from "hono";
import { privateKeyToAccount } from "viem/accounts";
import {
  createPublicClient,
  createWalletClient,
  formatUnits,
  http,
  isAddress,
  parseEventLogs,
} from "viem";
import { z } from "zod";
import {
  ERC7579AutopayModuleABI,
  getChain,
  getContractAddresses,
  PlanFactoryABI,
  SubscriptionRegistryABI,
} from "@arcenpay/internal-core";
import { Prisma } from "../../generated/client/client.js";
import { db } from "../../db.js";
import { getRpcUrl } from "../../config.js";
import { DEFAULT_CHAIN_ID } from "../../lib/platform/default-chain.js";
import { getLatestSubscriptionChangeRequest } from "../../lib/billing/subscription-change-requests.js";
import { toPrismaJson } from "../../utils/prisma-json.js";
import { requireAnyAuth, isAnyAuthError } from "../../lib/auth/require-any-auth.js";
import { resolveCompany, type CompanyKeys } from "../../lib/entitlements/flag-engine.js";
import { resolveEmbedAccessToken } from "../../lib/entitlements/embed-access-token.js";
import { getSession } from "../../lib/auth/auth.server.js";
import { resolveDashboardSessionIdentityDefaults } from "../../lib/auth/dashboard-session-identity.js";
import { resolveBillingRecipientEmail } from "../../lib/billing/billing-events.js";
import {
  enqueueSubscriptionActivationRecovery,
  finalizeSubscriptionActivation,
  processBillingRecoveryTask,
} from "../../lib/billing/billing-recovery.js";
import { upsertSubscriptionLedgerState } from "../../lib/billing/billing-ledger.js";
import { corsHeaders } from "../../middleware/cors.js";

const addressSchema = z
  .string()
  .refine((value) => isAddress(value), "Must be a valid EVM address");

const companySchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    wallet: addressSchema.optional(),
    email: z.string().email().optional(),
    name: z.string().trim().min(1).optional(),
    traits: z.record(z.string(), z.unknown()).optional(),
  })
  .refine(
    (value) => Boolean(value.id || value.wallet || value.email),
    "company.id, company.wallet, or company.email is required",
  );

const bodySchema = z.object({
  planId: z.union([z.string().trim().min(1), z.number().int().positive()]),
  paymentAccount: addressSchema,
  subscriberEmail: z.string().email().optional(),
  company: companySchema,
});

const registryBillerStatusAbi = [
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "authorizedBillers",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

const registryOwnerOfAbi = [
  {
    inputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
    name: "ownerOf",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

const erc20ReadAbi = [
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "allowance",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "decimals",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "symbol",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
  },
] as const;

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

async function clearScheduledCancellationTransition(
  companyId: string,
): Promise<boolean> {
  const company = await db.arcenCompany.findUnique({
    where: { id: companyId },
    select: { teamId: true, traits: true },
  });
  const currentTraits = asRecord(company?.traits);
  const transition = asRecord(currentTraits.subscriptionTransition);
  if (transition.mode !== "cancel_at_period_end") {
    return false;
  }

  const nextTraits = { ...currentTraits };
  delete nextTraits.subscriptionTransition;

  await db.arcenCompany.update({
    where: { id: companyId },
    data: {
      traits: toPrismaJson(nextTraits),
    },
  });

  if (company?.teamId) {
    const latestChangeRequest = await getLatestSubscriptionChangeRequest({
      teamId: company.teamId,
      companyId,
    });
    if (
      latestChangeRequest?.id &&
      !latestChangeRequest.id.startsWith("legacy-") &&
      latestChangeRequest.changeType === "cancellation"
    ) {
      await db.subscriptionChangeRequest.update({
        where: { id: latestChangeRequest.id },
        data: {
          stage: "REVERTED",
          appliedAt: new Date(),
          pendingVerification: false,
          failureReason: null,
        },
      });
    }
  }

  return true;
}

function normalizePrivateKey(raw: string | undefined): `0x${string}` | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withPrefix = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  return /^0x[a-fA-F0-9]{64}$/.test(withPrefix)
    ? (withPrefix as `0x${string}`)
    : null;
}

function formatTokenAmount(
  amount: bigint,
  decimals: number,
  symbol: string,
): string {
  const formatted = Number(formatUnits(amount, decimals));
  const safe =
    Number.isFinite(formatted) && formatted < 1_000_000_000
      ? formatted.toFixed(decimals === 6 ? 2 : Math.min(decimals, 4))
      : formatUnits(amount, decimals);
  return `${safe} ${symbol}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type AutopayActivationSnapshot = {
  isInitialized: boolean;
  config: {
    merchant?: string;
    maxAmount?: bigint;
    startTime?: bigint;
    planId?: bigint;
  } | null;
};

async function readAutopayActivationSnapshot(params: {
  publicClient: ReturnType<typeof createPublicClient>;
  autopayAddress: `0x${string}`;
  paymentAccount: `0x${string}`;
}): Promise<AutopayActivationSnapshot> {
  const isInitialized = (await params.publicClient.readContract({
    address: params.autopayAddress,
    abi: ERC7579AutopayModuleABI,
    functionName: "isInitialized",
    args: [params.paymentAccount],
  })) as boolean;

  if (!isInitialized) {
    return { isInitialized: false, config: null };
  }

  const config = (await params.publicClient.readContract({
    address: params.autopayAddress,
    abi: ERC7579AutopayModuleABI,
    functionName: "getConfig",
    args: [params.paymentAccount],
  })) as {
    merchant?: string;
    maxAmount?: bigint;
    startTime?: bigint;
    planId?: bigint;
  };

  return { isInitialized: true, config };
}

async function waitForAutopayActivationSnapshot(params: {
  publicClient: ReturnType<typeof createPublicClient>;
  autopayAddress: `0x${string}`;
  paymentAccount: `0x${string}`;
  expectedPlanId: bigint;
  expectedMerchant: string;
}): Promise<AutopayActivationSnapshot> {
  const attempts = 6;
  let latest: AutopayActivationSnapshot = {
    isInitialized: false,
    config: null,
  };

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    latest = await readAutopayActivationSnapshot(params);

    const configPlanId = BigInt(latest.config?.planId ?? 0n);
    const configMerchant = String(latest.config?.merchant ?? "").toLowerCase();
    if (
      latest.isInitialized &&
      configPlanId === params.expectedPlanId &&
      configMerchant === params.expectedMerchant
    ) {
      return latest;
    }

    if (attempt < attempts - 1) {
      await sleep(750);
    }
  }

  return latest;
}

function requiredConfirmations(): number {
  const raw = process.env.ONCHAIN_MIN_CONFIRMATIONS?.trim();
  if (!raw) return 2;

  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 2;
}

function normalizeActivationError(message: string): {
  status: number;
  error: string;
} {
  const lower = message.toLowerCase();

  if (
    lower.includes("transfer amount exceeds balance") ||
    lower.includes("erc20insufficientbalance")
  ) {
    return {
      status: 409,
      error:
        "The payment account does not have enough token balance for the first subscription charge.",
    };
  }

  if (
    lower.includes("insufficient allowance") ||
    lower.includes("erc20insufficientallowance")
  ) {
    return {
      status: 409,
      error:
        "The payment account has not approved enough token allowance for autopay to collect the first charge.",
    };
  }

  if (lower.includes("confirmation")) {
    return {
      status: 425,
      error: message,
    };
  }

  return {
    status: 500,
    error: message,
  };
}

async function assertReceiptFinalized(params: {
  publicClient: ReturnType<typeof createPublicClient>;
  receipt: { blockNumber?: bigint | null };
  label: string;
}): Promise<void> {
  const blockNumber = params.receipt.blockNumber;
  if (!blockNumber) {
    throw new Error(`${params.label} receipt is missing a block number.`);
  }

  const latestBlock = await params.publicClient.getBlockNumber();
  const confirmations =
    latestBlock >= blockNumber ? latestBlock - blockNumber + 1n : 0n;
  const required = BigInt(requiredConfirmations());

  if (confirmations < required) {
    throw new Error(
      `${params.label} has ${confirmations.toString()} confirmation(s); ${required.toString()} required before activating the subscription.`,
    );
  }
}

async function upsertCompanyForActivation(
  teamId: string,
  environmentId: string | null,
  keys: CompanyKeys & {
    name?: string;
    traits?: Record<string, unknown>;
  },
  paymentAccount?: string | null,
): Promise<{ id: string; activePlanId: string | null; created: boolean }> {
  const existing =
    (await resolveCompany(teamId, {
      ...keys,
      environmentId,
    })) ??
    (paymentAccount
      ? await resolveCompany(teamId, {
          wallet: paymentAccount,
          environmentId,
        })
      : null);
  if (existing) {
    const updates: Record<string, unknown> = {};
    if (keys.name?.trim()) updates.name = keys.name.trim();
    if (keys.email?.trim()) updates.email = keys.email.trim();
    if (keys.wallet?.trim()) {
      updates.walletAddress = keys.wallet.trim().toLowerCase();
    }
    if (Object.keys(updates).length > 0) {
      await db.arcenCompany.update({
        where: { id: existing.id },
        data: updates,
      });
    }
    return {
      id: existing.id,
      activePlanId: existing.activePlanId,
      created: false,
    };
  }

  const created = await db.arcenCompany.create({
    data: {
      teamId,
      environmentId,
      name: keys.name ?? keys.email ?? keys.id ?? "Unknown",
      email: keys.email ?? null,
      walletAddress: keys.wallet?.toLowerCase() ?? null,
      externalId: keys.id ?? null,
      traits: (keys.traits ?? {}) as unknown as Prisma.InputJsonValue,
    },
    select: { id: true },
  });

  return { id: created.id, activePlanId: null, created: true };
}

async function readActiveWalletSubscriptionTokenId(params: {
  publicClient: ReturnType<typeof createPublicClient>;
  subscriptionRegistryAddress: `0x${string}`;
  wallet: `0x${string}`;
}): Promise<bigint> {
  const hasActiveSubscription = (await params.publicClient.readContract({
    address: params.subscriptionRegistryAddress,
    abi: SubscriptionRegistryABI,
    functionName: "hasActiveSubscription",
    args: [params.wallet],
  })) as boolean;

  if (!hasActiveSubscription) return 0n;

  const tokenId = (await params.publicClient.readContract({
    address: params.subscriptionRegistryAddress,
    abi: SubscriptionRegistryABI,
    functionName: "getWalletSubscription",
    args: [params.wallet],
  })) as bigint;

  if (tokenId <= 0n) return 0n;

  const owner = (await params.publicClient.readContract({
    address: params.subscriptionRegistryAddress,
    abi: registryOwnerOfAbi,
    functionName: "ownerOf",
    args: [tokenId],
  })) as `0x${string}`;

  return owner.toLowerCase() === params.wallet.toLowerCase() ? tokenId : 0n;
}

export async function OPTIONS(c: Context) {
  return c.json(null, 204 as any, corsHeaders(c.req.header("origin")));
}

export async function POST(c: Context) {
  const origin = c.req.header("origin");
  const authHeader = c.req.header("authorization") ?? "";
  const bearerToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : "";

  let teamId: string;
  let embedTokenContext: Awaited<
    ReturnType<typeof resolveEmbedAccessToken>
  > | null = null;
  let sessionDefaults: Awaited<
    ReturnType<typeof resolveDashboardSessionIdentityDefaults>
  > | null = null;
  if (bearerToken && !bearerToken.startsWith("api_")) {
    embedTokenContext = await resolveEmbedAccessToken(bearerToken);
    if (!embedTokenContext) {
      return c.json(
        { error: "Invalid or expired token" },
        401,
        corsHeaders(origin),
      );
    }
    teamId = embedTokenContext.teamId;
  } else {
    const auth = await requireAnyAuth(c);
    if (isAnyAuthError(auth)) {
      return c.json({ ok: false, error: auth.error }, auth.status as any as any, corsHeaders(origin));
    }
    teamId = auth.teamId;
    if (auth.source === "session") {
      const session = await getSession();
      if (session) {
        sessionDefaults = await resolveDashboardSessionIdentityDefaults(
          teamId,
          (session as any).clerkUserId,
          auth.activeEnvironmentId ?? null,
        );
      }
    }
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { error: "Invalid JSON body" },
      400,
      corsHeaders(origin),
    );
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: "Invalid request",
        details: parsed.error.flatten().fieldErrors,
      },
      400,
      corsHeaders(origin),
    );
  }

  const onChainPlanId = BigInt(parsed.data.planId);
  const paymentAccount =
    parsed.data.paymentAccount.toLowerCase() as `0x${string}`;
  const activationCompanyInput = {
    ...parsed.data.company,
    ...(sessionDefaults && {
      name:
        parsed.data.company.name ?? sessionDefaults.companyName ?? undefined,
      email:
        parsed.data.company.email ?? sessionDefaults.companyEmail ?? undefined,
      wallet:
        parsed.data.company.wallet ??
        sessionDefaults.walletAddress ??
        undefined,
    }),
  };

  const catalogPlan = await db.catalogPlan.findFirst({
    where: {
      teamId,
      active: true,
      status: "PUBLISHED",
      onChainPlanId: onChainPlanId.toString(),
    },
    select: {
      id: true,
      name: true,
      acceptedToken: true,
      chainId: true,
      environmentId: true,
    },
  });

  if (!catalogPlan) {
    return c.json(
      {
        error:
          "Published team plan not found for the supplied on-chain planId.",
      },
      404,
      corsHeaders(origin),
    );
  }

  const company = await upsertCompanyForActivation(
    teamId,
    catalogPlan.environmentId ?? null,
    activationCompanyInput,
    paymentAccount,
  );

  // Use the chain the plan was registered on. Fall back to DEFAULT_CHAIN_ID for
  // legacy plans that pre-date the chainId column (they'll have the default 84532).
  const chainId = catalogPlan.chainId ?? DEFAULT_CHAIN_ID;
  const chain = getChain(chainId);
  const rpcUrl = getRpcUrl(chainId);
  const contracts = getContractAddresses(chainId);

  const billerPrivateKey = normalizePrivateKey(
    process.env.ONCHAIN_PROVIDER_PRIVATE_KEY ||
      process.env.SUBSCRIPTION_BILLER_PRIVATE_KEY ||
      process.env.BILLER_PRIVATE_KEY ||
      process.env.PRIVATE_KEY ||
      process.env.DEPLOYER_PRIVATE_KEY,
  );

  if (!billerPrivateKey) {
    return c.json(
      {
        error:
          "Subscription activation signer is not configured. Set SUBSCRIPTION_BILLER_PRIVATE_KEY on the dashboard backend.",
      },
      503,
      corsHeaders(origin),
    );
  }

  const autopayAddress = contracts.autopayModule as `0x${string}`;
  const subscriptionRegistryAddress =
    contracts.subscriptionRegistry as `0x${string}`;
  const planFactoryAddress = contracts.planFactory as `0x${string}`;

  const zeroAddress = "0x0000000000000000000000000000000000000000";
  if (
    !autopayAddress ||
    !subscriptionRegistryAddress ||
    !planFactoryAddress ||
    autopayAddress === zeroAddress ||
    subscriptionRegistryAddress === zeroAddress ||
    planFactoryAddress === zeroAddress
  ) {
    return c.json(
      {
        error: `Subscription contracts are not configured for chain ${chainId}.`,
      },
      503,
      corsHeaders(origin),
    );
  }

  const signerAccount = privateKeyToAccount(billerPrivateKey);
  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });
  const walletClient = createWalletClient({
    account: signerAccount,
    chain,
    transport: http(rpcUrl),
  });

  const onChainPlan = (await publicClient.readContract({
    address: planFactoryAddress,
    abi: PlanFactoryABI,
    functionName: "getPlan",
    args: [onChainPlanId],
  })) as {
    provider?: string;
    active?: boolean;
    price?: bigint;
    acceptedToken?: string;
  };

  const merchantAddress = String(onChainPlan?.provider ?? "").toLowerCase();
  if (!onChainPlan?.active) {
    return c.json(
      { error: "The requested on-chain plan is inactive." },
      409,
      corsHeaders(origin),
    );
  }

  if (merchantAddress !== signerAccount.address.toLowerCase()) {
    return c.json(
      {
        error:
          `Merchant signer mismatch. Plan ${onChainPlanId.toString()} is owned by ${merchantAddress}, ` +
          `but the configured backend signer is ${signerAccount.address.toLowerCase()}. ` +
          "Initial activation can only be executed by the plan's merchant wallet.",
      },
      409,
      corsHeaders(origin),
    );
  }

  const autopayAuthorized = (await publicClient.readContract({
    address: subscriptionRegistryAddress,
    abi: registryBillerStatusAbi,
    functionName: "authorizedBillers",
    args: [autopayAddress],
  })) as boolean;

  if (!autopayAuthorized) {
    return c.json(
      {
        error:
          "AutopayModule is not authorized as a biller on SubscriptionRegistry. Run the registry authorization step before activating subscriptions.",
      },
      409,
      corsHeaders(origin),
    );
  }

  const autopaySnapshot = await waitForAutopayActivationSnapshot({
    publicClient,
    autopayAddress,
    paymentAccount,
    expectedPlanId: onChainPlanId,
    expectedMerchant: signerAccount.address.toLowerCase(),
  });
  const isInitialized = autopaySnapshot.isInitialized;

  if (!isInitialized) {
    return c.json(
      {
        error:
          "Autopay is not installed for this payment account yet. Complete checkout setup before requesting activation.",
      },
      409,
      corsHeaders(origin),
    );
  }

  const autopayConfig = autopaySnapshot.config;

  const configPlanId = BigInt(autopayConfig?.planId ?? 0n);
  if (configPlanId !== onChainPlanId) {
    return c.json(
      {
        error: `Autopay config mismatch. Payment account is configured for on-chain plan ${configPlanId.toString()}, not ${onChainPlanId.toString()}.`,
      },
      409,
      corsHeaders(origin),
    );
  }

  const configMerchant = String(autopayConfig?.merchant ?? "").toLowerCase();
  if (configMerchant !== signerAccount.address.toLowerCase()) {
    return c.json(
      {
        error:
          `Autopay merchant mismatch. Payment account expects ${configMerchant}, ` +
          `but the backend signer is ${signerAccount.address.toLowerCase()}.`,
      },
      409,
      corsHeaders(origin),
    );
  }

  const chargeAmount = BigInt(autopayConfig?.maxAmount ?? 0n);
  if (chargeAmount <= 0n) {
    return c.json(
      { error: "Autopay config has no billable amount configured." },
      409,
      corsHeaders(origin),
    );
  }

  const acceptedTokenAddress = isAddress(
    String(onChainPlan?.acceptedToken ?? catalogPlan.acceptedToken ?? ""),
  )
    ? (String(
        onChainPlan?.acceptedToken ?? catalogPlan.acceptedToken,
      ).toLowerCase() as `0x${string}`)
    : null;

  if (!acceptedTokenAddress) {
    return c.json(
      { error: "Catalog plan accepted token is not configured correctly." },
      409,
      corsHeaders(origin),
    );
  }

  const [tokenBalance, tokenAllowance, tokenDecimals, tokenSymbol] =
    await Promise.all([
      publicClient.readContract({
        address: acceptedTokenAddress,
        abi: erc20ReadAbi,
        functionName: "balanceOf",
        args: [paymentAccount],
      }) as Promise<bigint>,
      publicClient.readContract({
        address: acceptedTokenAddress,
        abi: erc20ReadAbi,
        functionName: "allowance",
        args: [paymentAccount, autopayAddress],
      }) as Promise<bigint>,
      publicClient
        .readContract({
          address: acceptedTokenAddress,
          abi: erc20ReadAbi,
          functionName: "decimals",
        })
        .then((value) => Number(value))
        .catch(() => 6),
      publicClient
        .readContract({
          address: acceptedTokenAddress,
          abi: erc20ReadAbi,
          functionName: "symbol",
        })
        .then((value) => String(value))
        .catch(() => "tokens"),
    ]);

  if (tokenBalance < chargeAmount) {
    return c.json(
      {
        error:
          `The payment account does not have enough ${tokenSymbol} for the first charge. ` +
          `Required: ${formatTokenAmount(chargeAmount, tokenDecimals, tokenSymbol)}. ` +
          `Available: ${formatTokenAmount(tokenBalance, tokenDecimals, tokenSymbol)}.`,
      },
      409,
      corsHeaders(origin),
    );
  }

  if (tokenAllowance < chargeAmount) {
    return c.json(
      {
        error:
          `The payment account has not approved enough ${tokenSymbol} for autopay. ` +
          `Required: ${formatTokenAmount(chargeAmount, tokenDecimals, tokenSymbol)}. ` +
          `Approved: ${formatTokenAmount(tokenAllowance, tokenDecimals, tokenSymbol)}.`,
      },
      409,
      corsHeaders(origin),
    );
  }

  const startTime = Number(autopayConfig?.startTime ?? 0n);
  const latestBlock = await publicClient.getBlock({ blockTag: "latest" });
  const nowSeconds = Number(latestBlock.timestamp);
  if (startTime > nowSeconds) {
    const waitSeconds = startTime - nowSeconds;

    if (waitSeconds > 45) {
      return c.json(
        {
          error: `Autopay cannot start yet. The configured start time is ${new Date(startTime * 1000).toISOString()}.`,
        },
        409,
        corsHeaders(origin),
      );
    }

    await sleep((waitSeconds + 1) * 1000);
  }

  const existingTokenId = await readActiveWalletSubscriptionTokenId({
    publicClient,
    subscriptionRegistryAddress,
    wallet: paymentAccount,
  });

  if (existingTokenId > 0n) {
    const [existingExpiration, existingPlanFeatures] = await Promise.all([
      publicClient.readContract({
        address: subscriptionRegistryAddress,
        abi: SubscriptionRegistryABI,
        functionName: "expiresAt",
        args: [existingTokenId],
      }) as Promise<bigint>,
      publicClient.readContract({
        address: subscriptionRegistryAddress,
        abi: SubscriptionRegistryABI,
        functionName: "getPlanFeatures",
        args: [existingTokenId],
      }) as Promise<[bigint, string]>,
    ]);

    const existingOnChainPlanId = existingPlanFeatures[0].toString();
    const existingCatalogPlan =
      (await db.catalogPlan.findFirst({
        where: {
          teamId,
          onChainPlanId: existingOnChainPlanId,
        },
        select: { id: true, name: true },
      })) ?? null;

    await upsertSubscriptionLedgerState({
      teamId,
      companyId: company.id,
      walletAddress: paymentAccount,
      chainId,
      status: "ACTIVE",
      catalogPlanId: existingCatalogPlan?.id ?? catalogPlan.id,
      onChainPlanId: existingOnChainPlanId,
      onChainTokenId: existingTokenId.toString(),
      currentPeriodEnd:
        existingExpiration > 0n
          ? new Date(Number(existingExpiration) * 1000)
          : null,
      cancelAtPeriodEnd: false,
      cancelledAt: null,
      pastDueAt: null,
      graceEndsAt: null,
      lastEvent: "subscription.reconciled",
      lastEventAt: new Date(),
      metadata: {
        source: "subscription.activate",
        activationMode: "existing_token_reconciliation",
      },
    });

    if (existingOnChainPlanId === onChainPlanId.toString()) {
      const resumedCancellation =
        await clearScheduledCancellationTransition(company.id);

      return c.json(
        {
          data: {
            tokenId: existingTokenId.toString(),
            companyId: company.id,
            planId: existingCatalogPlan?.id ?? catalogPlan.id,
            paymentAccount,
            alreadyActive: true,
            reconciled: true,
            resumedCancellation,
          },
        },
        200,
        corsHeaders(origin),
      );
    }

    return c.json(
      {
        error:
          `This payment account already has an active subscription for on-chain plan ${existingOnChainPlanId}. ` +
          "Use a plan change flow instead of activation.",
        data: {
          tokenId: existingTokenId.toString(),
          companyId: company.id,
          currentPlanId: existingCatalogPlan?.id ?? null,
          requestedPlanId: catalogPlan.id,
          paymentAccount,
          reconciled: true,
        },
      },
      409,
      corsHeaders(origin),
    );
  }

  const walletConflict = await db.arcenCompany.findFirst({
    where: {
      teamId,
      environmentId: catalogPlan.environmentId ?? null,
      id: { not: company.id },
      OR: [
        { walletAddress: paymentAccount },
        {
          subscriptionState: {
            is: {
              walletAddress: paymentAccount,
            },
          },
        },
      ],
    },
    select: { id: true },
  });

  if (walletConflict) {
    return c.json(
      {
        error:
          "This payment account is already linked to a different company in this workspace environment. Reconcile the company mapping before activating the subscription.",
      },
      409,
      corsHeaders(origin),
    );
  }

  const previousCompany = await db.arcenCompany.findUnique({
    where: { id: company.id },
    select: { activePlanId: true },
  });

  try {
    const txHash = await walletClient.writeContract({
      account: signerAccount,
      address: autopayAddress,
      abi: ERC7579AutopayModuleABI,
      functionName: "execute",
      args: [paymentAccount, chargeAmount],
      chain,
    });

    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
      confirmations: requiredConfirmations(),
    });
    if (receipt.status !== "success") {
      return c.json(
        { error: "Initial subscription activation transaction failed." },
        502,
        corsHeaders(origin),
      );
    }
    await assertReceiptFinalized({
      publicClient,
      receipt,
      label: "Initial subscription activation transaction",
    });

    const receiptBlock =
      receipt.blockNumber != null
        ? await publicClient.getBlock({ blockNumber: receipt.blockNumber })
        : null;
    const occurredAt =
      receiptBlock?.timestamp != null
        ? new Date(Number(receiptBlock.timestamp) * 1000)
        : new Date();

    const billingLogs = parseEventLogs({
      abi: ERC7579AutopayModuleABI,
      logs: receipt.logs,
      eventName: "BillingExecuted",
      strict: false,
    });
    const latestBillingLog = [...billingLogs].reverse().find((log) => {
      const args = log.args as
        | { account?: string; merchant?: string; tokenId?: bigint }
        | undefined;
      return (
        typeof args?.account === "string" &&
        typeof args?.merchant === "string" &&
        args.account.toLowerCase() === paymentAccount &&
        args.merchant.toLowerCase() === merchantAddress
      );
    });

    let tokenId = ((latestBillingLog?.args as { tokenId?: bigint } | undefined)
      ?.tokenId ?? 0n) as bigint;

    const mintedLogs = parseEventLogs({
      abi: SubscriptionRegistryABI,
      logs: receipt.logs,
      eventName: "SubscriptionMinted",
      strict: false,
    });
    const renewedLogs = parseEventLogs({
      abi: SubscriptionRegistryABI,
      logs: receipt.logs,
      eventName: "SubscriptionRenewed",
      strict: false,
    });

    let expiresAt = 0n;

    const latestMintLog = [...mintedLogs].reverse().find((log) => {
      const args = log.args as
        | { subscriber?: string; tokenId?: bigint; expiration?: bigint }
        | undefined;
      return (
        typeof args?.subscriber === "string" &&
        args.subscriber.toLowerCase() === paymentAccount &&
        (tokenId <= 0n || args.tokenId === tokenId)
      );
    });

    if (latestMintLog) {
      const args = latestMintLog.args as {
        tokenId?: bigint;
        expiration?: bigint;
      };
      if (args.tokenId && args.tokenId > 0n) tokenId = args.tokenId;
      if (args.expiration && args.expiration > 0n) expiresAt = args.expiration;
    }

    const latestRenewLog =
      tokenId > 0n
        ? [...renewedLogs].reverse().find((log) => {
            const args = log.args as
              | { tokenId?: bigint; newExpiration?: bigint }
              | undefined;
            return args?.tokenId === tokenId;
          })
        : undefined;

    if (!latestMintLog && latestRenewLog) {
      const args = latestRenewLog.args as {
        newExpiration?: bigint;
      };
      if (args.newExpiration && args.newExpiration > 0n) {
        expiresAt = args.newExpiration;
      }
    }

    if (tokenId <= 0n) {
      tokenId = await readActiveWalletSubscriptionTokenId({
        publicClient,
        subscriptionRegistryAddress,
        wallet: paymentAccount,
      });
    }

    if (tokenId <= 0n) {
      throw new Error(
        "Activation transaction succeeded, but no active subscription token could be resolved for the payment account.",
      );
    }

    if (expiresAt <= 0n) {
      expiresAt = (await publicClient.readContract({
        address: subscriptionRegistryAddress,
        abi: SubscriptionRegistryABI,
        functionName: "expiresAt",
        args: [tokenId],
      })) as bigint;
    }

    const subscriberEmail = await resolveBillingRecipientEmail({
      teamId,
      explicitEmail:
        parsed.data.subscriberEmail ?? sessionDefaults?.userEmail ?? null,
      accessTokenUserId: embedTokenContext?.userId ?? null,
      accessTokenCompanyId: embedTokenContext?.companyId ?? null,
      companyId: company.id,
      walletAddress: paymentAccount,
    });

    const finalizationPayload = {
      companyId: company.id,
      environmentId: catalogPlan.environmentId ?? null,
      walletAddress: paymentAccount,
      catalogPlanId: catalogPlan.id,
      catalogPlanName: catalogPlan.name,
      onChainPlanId: onChainPlanId.toString(),
      onChainTokenId: tokenId.toString(),
      expiration: expiresAt.toString(),
      txHash,
      amount: Number(chargeAmount) / 1e6,
      currency: "USDC",
      merchantAddress,
      acceptedToken: catalogPlan.acceptedToken ?? null,
      subscriberEmail,
      occurredAt: occurredAt.toISOString(),
      previousPlanId: previousCompany?.activePlanId ?? null,
    };

    let recoveryTaskId: string | null = null;
    let recoveryPending = false;

    try {
      await finalizeSubscriptionActivation({
        teamId,
        payload: finalizationPayload,
        source: "subscription.activate",
      });
    } catch (finalizationError) {
      console.error(
        "[subscriptions/activate] Immediate billing finalization failed; queuing recovery task.",
        finalizationError,
      );

      const recoveryTask = await enqueueSubscriptionActivationRecovery({
        teamId,
        ...finalizationPayload,
        occurredAt: new Date(finalizationPayload.occurredAt),
      });
      recoveryTaskId = recoveryTask.id;

      const recoveryResult = await processBillingRecoveryTask({
        taskId: recoveryTask.id,
      });
      recoveryPending = !recoveryResult.ok;
    }

    return c.json(
      {
        data: {
          tokenId: tokenId.toString(),
          txHash,
          companyId: company.id,
          planId: catalogPlan.id,
          paymentAccount,
          recoveryTaskId,
          recoveryPending,
        },
      },
      recoveryPending ? 202 : 200,
      corsHeaders(origin),
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to activate subscription.";
    const normalized = normalizeActivationError(message);
    return c.json(
      { error: normalized.error },
      normalized.status as any,
      corsHeaders(origin),
    );
  }
}
