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
  http,
  isAddress,
  type Chain,
} from "viem";
import { base, baseSepolia, sepolia } from "viem/chains";
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
import { requireAnyAuth, isAnyAuthError } from "@/lib/require-any-auth";
import {
  resolveCompany,
  type CompanyKeys,
} from "@/lib/flag-engine";
import { deliverWebhook } from "@/lib/deliver-webhook";

const CHAIN_MAP: Record<number, Chain> = {
  11155111: sepolia,
  84532: baseSepolia,
  8453: base,
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

async function upsertCompanyForActivation(
  teamId: string,
  keys: CompanyKeys & {
    name?: string;
    traits?: Record<string, unknown>;
  },
): Promise<{ id: string; activePlanId: string | null; created: boolean }> {
  const existing = await resolveCompany(teamId, keys);
  if (existing) {
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

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function POST(req: NextRequest) {
  const auth = await requireAnyAuth(req);
  if (isAnyAuthError(auth)) {
    return auth;
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

  const teamId = auth.teamId;
  const onChainPlanId = BigInt(parsed.data.planId);
  const paymentAccount = parsed.data.paymentAccount.toLowerCase() as `0x${string}`;
  const subscriberEmail = parsed.data.subscriberEmail;

  const company = await upsertCompanyForActivation(teamId, parsed.data.company);

  const catalogPlan = await db.catalogPlan.findFirst({
    where: {
      teamId,
      active: true,
      status: "PUBLISHED",
      onChainPlanId: onChainPlanId.toString(),
    },
    select: { id: true, name: true },
  });

  if (!catalogPlan) {
    return NextResponse.json(
      { error: "Published team plan not found for the supplied on-chain planId." },
      { status: 404, headers: corsHeaders() },
    );
  }

  const chainId = Number(
    process.env.MEAP_DEFAULT_CHAIN_ID ||
      process.env.CHAIN_ID ||
      process.env.NEXT_PUBLIC_CHAIN_ID ||
      "11155111",
  );
  const chain = CHAIN_MAP[chainId] ?? sepolia;
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

    const tokenId = (await publicClient.readContract({
      address: subscriptionRegistryAddress,
      abi: SubscriptionRegistryABI,
      functionName: "getWalletSubscription",
      args: [paymentAccount],
    })) as bigint;

    await db.arcenCompany.update({
      where: { id: company.id },
      data: {
        walletAddress: paymentAccount,
        activePlanId: catalogPlan.id,
      },
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

    deliverWebhook(teamId, "company.plan.changed", {
      companyId: company.id,
      planId: catalogPlan.id,
      planName: catalogPlan.name,
      previousPlanId: previousCompany?.activePlanId ?? null,
      txHash,
      source: "subscription.activate",
    }).catch(() => {});

    return NextResponse.json(
      {
        data: {
          tokenId: tokenId.toString(),
          txHash,
          companyId: company.id,
          planId: catalogPlan.id,
          paymentAccount,
        },
      },
      { headers: corsHeaders() },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to activate subscription.";
    return NextResponse.json(
      { error: message },
      { status: 500, headers: corsHeaders() },
    );
  }
}
