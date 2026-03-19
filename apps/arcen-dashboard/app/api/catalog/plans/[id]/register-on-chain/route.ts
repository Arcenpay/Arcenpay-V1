import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission, isErrorResponse } from "@/lib/api-auth";
import { writeAuditEvent } from "@/lib/audit";
import { getRpcUrl } from "@/lib/config";
import {
  createWalletClient,
  createPublicClient,
  encodeFunctionData,
  http,
  verifyTypedData,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia, base, baseSepolia } from "viem/chains";
import { PlanFactoryABI, getContractAddresses, TOKENS } from "@meap/core";
import { isAddress, type Chain } from "viem";
import { z } from "zod";

// Allow up to 60 s on Vercel (long enough to wait for tx confirmation)
export const maxDuration = 60;

// Request schema for EIP-712 signed plan registration
const RegisterOnChainSchema = z.object({
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
  deadline: z.number().int().positive(),
  userAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
});

// EIP-712 domain and types matching the PlanFactory contract
const PLAN_FACTORY_DOMAIN = {
  name: "ArcenPay PlanFactory",
  version: "1",
} as const;

const CREATE_PLAN_TYPES = {
  CreatePlan: [
    { name: "provider", type: "address" },
    { name: "name", type: "string" },
    { name: "tier", type: "string" },
    { name: "price", type: "uint256" },
    { name: "billingInterval", type: "uint32" },
    { name: "acceptedToken", type: "address" },
    { name: "metadataURI", type: "string" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

// ABI fragments for createPlanFor and nonces
const CREATE_PLAN_FOR_ABI = [
  {
    inputs: [
      { name: "provider", type: "address" },
      { name: "name", type: "string" },
      { name: "tier", type: "string" },
      { name: "price", type: "uint256" },
      { name: "billingInterval", type: "uint32" },
      { name: "acceptedToken", type: "address" },
      { name: "metadataURI", type: "string" },
      { name: "deadline", type: "uint256" },
      { name: "signature", type: "bytes" },
    ],
    name: "createPlanFor",
    outputs: [{ name: "planId", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "provider", type: "address" }],
    name: "nonces",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

// Minimal ABI fragments for provider registration (not in SDK's PlanFactoryABI export)
const PROVIDER_REGISTRY_ABI = [
  {
    inputs: [{ internalType: "address", name: "provider", type: "address" }],
    name: "isProvider",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "provider", type: "address" }],
    name: "registerProvider",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

const OWNABLE_OWNER_ABI = [
  {
    inputs: [],
    name: "owner",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

const CHAIN_MAP: Record<number, Chain> = {
  11155111: sepolia,
  84532: baseSepolia,
  8453: base,
};

type Params = { id: string };

function normalizePrivateKey(raw: string | undefined): `0x${string}` | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const withPrefix = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  return /^0x[a-fA-F0-9]{64}$/.test(withPrefix)
    ? (withPrefix as `0x${string}`)
    : null;
}

function normalizeAddress(raw: string | undefined): `0x${string}` | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return isAddress(trimmed) ? (trimmed as `0x${string}`) : null;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<Params> },
) {
  const auth = await requirePermission("catalog:write");
  if (isErrorResponse(auth)) return auth;

  const { id: planId } = await context.params;

  // Parse and validate request body with EIP-712 signature
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = RegisterOnChainSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { signature, deadline, userAddress } = parsed.data;

  // Verify the user address matches the authenticated user's wallet
  if (!auth.team.walletAddress) {
    return NextResponse.json(
      {
        error:
          "No wallet linked to this account. Please link your wallet first.",
      },
      { status: 400 },
    );
  }

  if (auth.team.walletAddress.toLowerCase() !== userAddress.toLowerCase()) {
    return NextResponse.json(
      { error: "Signature must be from your authenticated wallet" },
      { status: 403 },
    );
  }

  const plan = await db.catalogPlan.findFirst({
    where: { id: planId, teamId: auth.team.teamId },
  });

  if (!plan) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }

  const relayerPrivateKey = normalizePrivateKey(
    process.env.DEPLOYER_PRIVATE_KEY,
  );
  if (!relayerPrivateKey) {
    return NextResponse.json(
      {
        error:
          "Server relayer not configured (DEPLOYER_PRIVATE_KEY missing or invalid).",
      },
      { status: 503 },
    );
  }

  const chainId = parseInt(process.env.NEXT_PUBLIC_CHAIN_ID ?? "11155111");
  const rpcUrl = getRpcUrl(chainId);
  const chain = CHAIN_MAP[chainId] ?? sepolia;

  const contracts = getContractAddresses(chainId);
  const planFactoryAddress = contracts.planFactory as `0x${string}`;

  if (
    !planFactoryAddress ||
    planFactoryAddress === "0x0000000000000000000000000000000000000000"
  ) {
    return NextResponse.json(
      { error: "PlanFactory not deployed on this chain" },
      { status: 503 },
    );
  }

  // Auto-publish DRAFT plans before registering on-chain
  if (plan.status === "DRAFT") {
    await db.catalogPlan.update({
      where: { id: planId },
      data: { status: "PUBLISHED", publishedAt: new Date() },
    });
  }

  const relayerAccount = privateKeyToAccount(relayerPrivateKey);
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const walletClient = createWalletClient({
    account: relayerAccount,
    chain,
    transport: http(rpcUrl),
  });

  const priceInUsdc = BigInt(
    Math.round(parseFloat(plan.price.toString()) * 1_000_000),
  );
  const billingIntervalSeconds = plan.billingInterval * 86400;
  const storedToken = plan.acceptedToken;
  const usdcAddress = (
    storedToken.startsWith("0x") && storedToken.length === 42
      ? storedToken
      : (TOKENS[chainId as keyof typeof TOKENS]?.USDC ?? storedToken)
  ) as `0x${string}`;

  // Get user's nonce from the contract
  const nonce = await publicClient.readContract({
    address: planFactoryAddress,
    abi: CREATE_PLAN_FOR_ABI,
    functionName: "nonces",
    args: [userAddress as `0x${string}`],
  });

  // Verify the signature server-side before submitting
  const isValidSig = await verifyTypedData({
    address: userAddress as `0x${string}`,
    domain: {
      ...PLAN_FACTORY_DOMAIN,
      chainId: BigInt(chainId),
      verifyingContract: planFactoryAddress,
    },
    types: CREATE_PLAN_TYPES,
    primaryType: "CreatePlan",
    message: {
      provider: userAddress as `0x${string}`,
      name: plan.name,
      tier: plan.tier,
      price: priceInUsdc,
      billingInterval: billingIntervalSeconds,
      acceptedToken: usdcAddress,
      metadataURI: "",
      nonce,
      deadline: BigInt(deadline),
    },
    signature: signature as `0x${string}`,
  });

  if (!isValidSig) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // Mark as pending before submission so UI reflects in-progress state
  await db.catalogPlan.update({
    where: { id: planId },
    data: { chainSyncStatus: "PENDING", chainSyncError: null },
  });

  // Check if the USER is registered as a provider (not the relayer)
  const isUserRegistered = await publicClient
    .readContract({
      address: planFactoryAddress,
      abi: PROVIDER_REGISTRY_ABI,
      functionName: "isProvider",
      args: [userAddress as `0x${string}`],
    })
    .catch(() => false as boolean);

  if (!isUserRegistered) {
    // Try to register the user as a provider if we have the owner key
    const ownerKey = normalizePrivateKey(
      process.env.PLAN_FACTORY_OWNER_PRIVATE_KEY,
    );

    const planFactoryOwner = await publicClient
      .readContract({
        address: planFactoryAddress,
        abi: OWNABLE_OWNER_ABI,
        functionName: "owner",
      })
      .catch(() => null as `0x${string}` | null);

    if (!ownerKey) {
      const ownerHint = planFactoryOwner
        ? ` PlanFactory owner is ${planFactoryOwner}.`
        : "";
      const registerProviderCalldata = encodeFunctionData({
        abi: PROVIDER_REGISTRY_ABI,
        functionName: "registerProvider",
        args: [userAddress as `0x${string}`],
      });
      await db.catalogPlan.update({
        where: { id: planId },
        data: {
          chainSyncStatus: "FAILED",
          chainSyncError: `Your wallet is not registered as a provider.${ownerHint} Owner action required: execute registerProvider(${userAddress}) from owner/multisig.`,
        },
      });
      return NextResponse.json(
        {
          error: `Your wallet is not a registered provider.${ownerHint} Contact the platform admin or execute owner registration via Safe/multisig.`,
          userAddress,
          planFactoryOwner,
          ownerActionRequired: {
            description:
              "Execute registerProvider(userAddress) on PlanFactory from owner wallet/multisig.",
            target: planFactoryAddress,
            value: "0",
            data: registerProviderCalldata,
            functionSignature: "registerProvider(address)",
            args: [userAddress],
            safeTransaction: {
              to: planFactoryAddress,
              value: "0",
              data: registerProviderCalldata,
              operation: 0,
            },
          },
        },
        { status: 409 },
      );
    }

    // Auto-register the user as a provider
    try {
      const ownerAccount = privateKeyToAccount(ownerKey);
      if (
        planFactoryOwner &&
        ownerAccount.address.toLowerCase() !== planFactoryOwner.toLowerCase()
      ) {
        await db.catalogPlan.update({
          where: { id: planId },
          data: {
            chainSyncStatus: "FAILED",
            chainSyncError: `PLAN_FACTORY_OWNER_PRIVATE_KEY does not match on-chain owner (${planFactoryOwner}).`,
          },
        });
        return NextResponse.json(
          {
            error: `Owner key mismatch with on-chain owner (${planFactoryOwner}).`,
          },
          { status: 409 },
        );
      }

      const ownerWallet = createWalletClient({
        account: ownerAccount,
        chain,
        transport: http(rpcUrl),
      });
      const regTxHash = await ownerWallet.writeContract({
        address: planFactoryAddress,
        abi: PROVIDER_REGISTRY_ABI,
        functionName: "registerProvider",
        args: [userAddress as `0x${string}`],
      });
      await publicClient.waitForTransactionReceipt({
        hash: regTxHash,
        timeout: 45_000,
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Provider registration failed";
      await db.catalogPlan.update({
        where: { id: planId },
        data: { chainSyncStatus: "FAILED", chainSyncError: message },
      });
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  // Call createPlanFor - relayer pays gas, user is the owner
  let txHash: `0x${string}`;
  try {
    txHash = await walletClient.writeContract({
      address: planFactoryAddress,
      abi: CREATE_PLAN_FOR_ABI,
      functionName: "createPlanFor",
      args: [
        userAddress as `0x${string}`,
        plan.name,
        plan.tier,
        priceInUsdc,
        billingIntervalSeconds,
        usdcAddress,
        "",
        BigInt(deadline),
        signature as `0x${string}`,
      ],
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Transaction submission failed";
    await db.catalogPlan.update({
      where: { id: planId },
      data: { chainSyncStatus: "FAILED", chainSyncError: message },
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // Wait for on-chain confirmation (up to 45 s)
  try {
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
      timeout: 45_000,
    });

    if (receipt.status === "reverted") {
      await db.catalogPlan.update({
        where: { id: planId },
        data: {
          chainSyncStatus: "FAILED",
          chainTxHash: txHash,
          chainSyncError: "Transaction reverted on-chain",
        },
      });
      return NextResponse.json(
        { error: "Transaction reverted on-chain", txHash },
        { status: 500 },
      );
    }
  } catch {
    // Confirmation timed out — tx was submitted, mark SYNCED optimistically
  }

  const updatedPlan = await db.catalogPlan.update({
    where: { id: planId },
    data: {
      chainSyncStatus: "SYNCED",
      chainTxHash: txHash,
      chainSyncError: null,
      chainSyncedAt: new Date(),
    },
  });

  await writeAuditEvent({
    request,
    teamId: auth.team.teamId,
    userId: auth.team.userId,
    walletAddress: auth.team.walletAddress,
    action: "catalog.plan.chain_synced",
    resourceType: "CatalogPlan",
    resourceId: planId,
    metadata: {
      txHash,
      relayer: relayerAccount.address,
      planOwner: userAddress,
    },
  });

  return NextResponse.json({
    ok: true,
    txHash,
    plan: updatedPlan,
    planOwner: userAddress,
  });
}
