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

import { NextRequest, NextResponse } from "next/server";
import { privateKeyToAccount } from "viem/accounts";
import {
  createPublicClient,
  createWalletClient,
  formatUnits,
  http,
  isAddress,
  parseEventLogs,
  type Chain,
} from "viem";
import { baseSepolia } from "viem/chains";
import { z } from "zod";
import {
  ERC7579AutopayModuleABI,
  getContractAddresses,
  PlanFactoryABI,
  SubscriptionRegistryABI,
} from "@arcenpay/sdk";
import { Prisma } from "@/src/generated/prisma/client";
import { db } from "@/lib/db";
import { getRpcUrl } from "@/lib/config";
import { DEFAULT_CHAIN_ID } from "@/lib/default-chain";
import { requireAnyAuth, isAnyAuthError } from "@/lib/require-any-auth";
import {
  resolveCompany,
  type CompanyKeys,
} from "@/lib/flag-engine";
import { resolveEmbedAccessToken } from "@/lib/embed-access-token";
import { getSession } from "@/lib/auth.server";
import { resolveDashboardSessionIdentityDefaults } from "@/lib/dashboard-session-identity";
import { resolveBillingRecipientEmail } from "@/lib/billing-events";
import {
  enqueueSubscriptionActivationRecovery,
  processBillingRecoveryTask,
} from "@/lib/billing-recovery";

const CHAIN_MAP: Record<number, Chain> = {
  84532: baseSepolia,
};

const addressSchema = z.string().refine(
  (value) => isAddress(value),
  "Must be a valid EVM address",
);

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

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
  };
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

  return {
    status: 500,
    error: message,
  };
}

async function upsertCompanyForActivation(
  teamId: string,
  keys: CompanyKeys & {
    name?: string;
    traits?: Record<string, unknown>;
  },
): Promise<{ id: string; activePlanId: string | null; created: boolean }> {
  const existing = await resolveCompany(teamId, keys);
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
      name: keys.name ?? keys.email ?? keys.id ?? "Unknown",
      email: keys.email ?? null,
      walletAddress: keys.wallet?.toLowerCase() ?? null,
      externalId: keys.id ?? null,
      traits: ((keys.traits ?? {}) as unknown) as Prisma.InputJsonValue,
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

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  let teamId: string;
  let embedTokenContext:
    | Awaited<ReturnType<typeof resolveEmbedAccessToken>>
    | null = null;
  let sessionDefaults:
    | Awaited<ReturnType<typeof resolveDashboardSessionIdentityDefaults>>
    | null = null;
  if (bearerToken && !bearerToken.startsWith("api_")) {
    embedTokenContext = await resolveEmbedAccessToken(bearerToken);
    if (!embedTokenContext) {
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 401, headers: corsHeaders() },
      );
    }
    teamId = embedTokenContext.teamId;
  } else {
    const auth = await requireAnyAuth(req);
    if (isAnyAuthError(auth)) {
      return auth;
    }
    teamId = auth.teamId;
    if (auth.source === "session") {
      const session = await getSession();
      if (session) {
        sessionDefaults = await resolveDashboardSessionIdentityDefaults(
          teamId,
          session.clerkUserId,
        );
      }
    }
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400, headers: corsHeaders() },
    );
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid request",
        details: parsed.error.flatten().fieldErrors,
      },
      { status: 400, headers: corsHeaders() },
    );
  }

  const onChainPlanId = BigInt(parsed.data.planId);
  const paymentAccount = parsed.data.paymentAccount.toLowerCase() as `0x${string}`;
  const activationCompanyInput = {
    ...parsed.data.company,
    ...(sessionDefaults && {
      name: parsed.data.company.name ?? sessionDefaults.companyName ?? undefined,
      email: parsed.data.company.email ?? sessionDefaults.companyEmail ?? undefined,
      wallet: parsed.data.company.wallet ?? sessionDefaults.walletAddress ?? undefined,
    }),
  };

  const company = await upsertCompanyForActivation(teamId, activationCompanyInput);

  const catalogPlan = await db.catalogPlan.findFirst({
    where: {
      teamId,
      active: true,
      status: "PUBLISHED",
      onChainPlanId: onChainPlanId.toString(),
    },
    select: { id: true, name: true, acceptedToken: true },
  });

  if (!catalogPlan) {
    return NextResponse.json(
      { error: "Published team plan not found for the supplied on-chain planId." },
      { status: 404, headers: corsHeaders() },
    );
  }

  const chainId = DEFAULT_CHAIN_ID;
  const chain = CHAIN_MAP[chainId] ?? baseSepolia;
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
    return NextResponse.json(
      {
        error:
          "Subscription activation signer is not configured. Set SUBSCRIPTION_BILLER_PRIVATE_KEY on the dashboard backend.",
      },
      { status: 503, headers: corsHeaders() },
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
    return NextResponse.json(
      { error: `Subscription contracts are not configured for chain ${chainId}.` },
      { status: 503, headers: corsHeaders() },
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
    return NextResponse.json(
      { error: "The requested on-chain plan is inactive." },
      { status: 409, headers: corsHeaders() },
    );
  }

  if (merchantAddress !== signerAccount.address.toLowerCase()) {
    return NextResponse.json(
      {
        error:
          `Merchant signer mismatch. Plan ${onChainPlanId.toString()} is owned by ${merchantAddress}, ` +
          `but the configured backend signer is ${signerAccount.address.toLowerCase()}. ` +
          "Initial activation can only be executed by the plan's merchant wallet.",
      },
      { status: 409, headers: corsHeaders() },
    );
  }

  const autopayAuthorized = (await publicClient.readContract({
    address: subscriptionRegistryAddress,
    abi: registryBillerStatusAbi,
    functionName: "authorizedBillers",
    args: [autopayAddress],
  })) as boolean;

  if (!autopayAuthorized) {
    return NextResponse.json(
      {
        error:
          "AutopayModule is not authorized as a biller on SubscriptionRegistry. Run the registry authorization step before activating subscriptions.",
      },
      { status: 409, headers: corsHeaders() },
    );
  }

  const isInitialized = (await publicClient.readContract({
    address: autopayAddress,
    abi: ERC7579AutopayModuleABI,
    functionName: "isInitialized",
    args: [paymentAccount],
  })) as boolean;

  if (!isInitialized) {
    return NextResponse.json(
      {
        error:
          "Autopay is not installed for this payment account yet. Complete checkout setup before requesting activation.",
      },
      { status: 409, headers: corsHeaders() },
    );
  }

  const autopayConfig = (await publicClient.readContract({
    address: autopayAddress,
    abi: ERC7579AutopayModuleABI,
    functionName: "getConfig",
    args: [paymentAccount],
  })) as {
    merchant?: string;
    maxAmount?: bigint;
    startTime?: bigint;
    planId?: bigint;
  };

  const configPlanId = BigInt(autopayConfig?.planId ?? 0n);
  if (configPlanId !== onChainPlanId) {
    return NextResponse.json(
      {
        error:
          `Autopay config mismatch. Payment account is configured for on-chain plan ${configPlanId.toString()}, not ${onChainPlanId.toString()}.`,
      },
      { status: 409, headers: corsHeaders() },
    );
  }

  const configMerchant = String(autopayConfig?.merchant ?? "").toLowerCase();
  if (configMerchant !== signerAccount.address.toLowerCase()) {
    return NextResponse.json(
      {
        error:
          `Autopay merchant mismatch. Payment account expects ${configMerchant}, ` +
          `but the backend signer is ${signerAccount.address.toLowerCase()}.`,
      },
      { status: 409, headers: corsHeaders() },
    );
  }

  const chargeAmount = BigInt(autopayConfig?.maxAmount ?? 0n);
  if (chargeAmount <= 0n) {
    return NextResponse.json(
      { error: "Autopay config has no billable amount configured." },
      { status: 409, headers: corsHeaders() },
    );
  }

  const acceptedTokenAddress =
    isAddress(String(onChainPlan?.acceptedToken ?? catalogPlan.acceptedToken ?? ""))
      ? (String(
          onChainPlan?.acceptedToken ?? catalogPlan.acceptedToken,
        ).toLowerCase() as `0x${string}`)
      : null;

  if (!acceptedTokenAddress) {
    return NextResponse.json(
      { error: "Catalog plan accepted token is not configured correctly." },
      { status: 409, headers: corsHeaders() },
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
    return NextResponse.json(
      {
        error:
          `The payment account does not have enough ${tokenSymbol} for the first charge. ` +
          `Required: ${formatTokenAmount(chargeAmount, tokenDecimals, tokenSymbol)}. ` +
          `Available: ${formatTokenAmount(tokenBalance, tokenDecimals, tokenSymbol)}.`,
      },
      { status: 409, headers: corsHeaders() },
    );
  }

  if (tokenAllowance < chargeAmount) {
    return NextResponse.json(
      {
        error:
          `The payment account has not approved enough ${tokenSymbol} for autopay. ` +
          `Required: ${formatTokenAmount(chargeAmount, tokenDecimals, tokenSymbol)}. ` +
          `Approved: ${formatTokenAmount(tokenAllowance, tokenDecimals, tokenSymbol)}.`,
      },
      { status: 409, headers: corsHeaders() },
    );
  }

  const startTime = Number(autopayConfig?.startTime ?? 0n);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (startTime > nowSeconds) {
    return NextResponse.json(
      {
        error:
          `Autopay cannot start yet. The configured start time is ${new Date(startTime * 1000).toISOString()}.`,
      },
      { status: 409, headers: corsHeaders() },
    );
  }

  const existingTokenId = await readActiveWalletSubscriptionTokenId({
    publicClient,
    subscriptionRegistryAddress,
    wallet: paymentAccount,
  });

  if (existingTokenId > 0n) {
    return NextResponse.json(
      {
        error:
          "This payment account already has an on-chain subscription token. Refusing to execute activation again to avoid a duplicate charge.",
        data: {
          tokenId: existingTokenId.toString(),
          companyId: company.id,
          planId: catalogPlan.id,
          paymentAccount,
        },
      },
      { status: 409, headers: corsHeaders() },
    );
  }

  const walletConflict = await db.arcenCompany.findFirst({
    where: {
      teamId,
      walletAddress: paymentAccount,
      NOT: { id: company.id },
    },
    select: { id: true },
  });

  if (walletConflict) {
    return NextResponse.json(
      {
        error:
          "This payment account is already linked to a different company in your workspace. Reconcile the company mapping before activating the subscription.",
      },
      { status: 409, headers: corsHeaders() },
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

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      return NextResponse.json(
        { error: "Initial subscription activation transaction failed." },
        { status: 502, headers: corsHeaders() },
      );
    }

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

    let tokenId =
      ((latestBillingLog?.args as { tokenId?: bigint } | undefined)?.tokenId ??
        0n) as bigint;

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

    const currentPeriodEnd =
      expiresAt > 0n ? new Date(Number(expiresAt) * 1000) : null;

    const subscriberEmail = await resolveBillingRecipientEmail({
      teamId,
      explicitEmail:
        parsed.data.subscriberEmail ??
        sessionDefaults?.userEmail ??
        null,
      accessTokenUserId: embedTokenContext?.userId ?? null,
      accessTokenCompanyId: embedTokenContext?.companyId ?? null,
      companyId: company.id,
      walletAddress: paymentAccount,
    });

    if (subscriberEmail) {
      await db.subscriberEmail.upsert({
        where: { walletAddress: paymentAccount },
        update: {
          email: subscriberEmail,
          planId: catalogPlan.id,
        },
        create: {
          walletAddress: paymentAccount,
          email: subscriberEmail,
          planId: catalogPlan.id,
        },
      });
    }

    const recoveryTask = await enqueueSubscriptionActivationRecovery({
      teamId,
      companyId: company.id,
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
      occurredAt: new Date(),
      previousPlanId: previousCompany?.activePlanId ?? null,
    });

    const recoveryResult = await processBillingRecoveryTask({
      taskId: recoveryTask.id,
    });
    const recoveryPending = !recoveryResult.ok;

    return NextResponse.json(
      {
        data: {
          tokenId: tokenId.toString(),
          txHash,
          companyId: company.id,
          planId: catalogPlan.id,
          paymentAccount,
          recoveryTaskId: recoveryTask.id,
          recoveryPending,
        },
      },
      {
        status: recoveryPending ? 202 : 200,
        headers: corsHeaders(),
      },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to activate subscription.";
    const normalized = normalizeActivationError(message);
    return NextResponse.json(
      { error: normalized.error },
      { status: normalized.status, headers: corsHeaders() },
    );
  }
}
