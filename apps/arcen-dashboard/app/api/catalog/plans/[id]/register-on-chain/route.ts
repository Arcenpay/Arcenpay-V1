import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission, isErrorResponse } from "@/lib/api-auth";
import { writeAuditEvent } from "@/lib/audit";
import { getRpcUrl } from "@/lib/config";
import fs from "node:fs";
import path from "node:path";
import {
  createWalletClient,
  createPublicClient,
  encodeFunctionData,
  http,
  verifyTypedData,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia, base, baseSepolia } from "viem/chains";
import { PlanFactoryABI, getContractAddresses, TOKENS } from "@arcenpay/sdk";
import { isAddress, type Chain } from "viem";
import { z } from "zod";

// Allow up to 60 s on Vercel (long enough to wait for tx confirmation)
export const maxDuration = 60;

// Request schema for EIP-712 signed plan registration
const RegisterOnChainSchema = z.object({
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/).optional(),
  deadline: z.number().int().positive().optional(),
  userAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
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

function resolveDefaultChainId(
  environmentMode: "DEVELOPMENT" | "PRODUCTION",
): number {
  return environmentMode === "PRODUCTION" ? 8453 : 11155111;
}

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

function getManagedProviderPrivateKey(): `0x${string}` | null {
  return normalizePrivateKey(
    process.env.ONCHAIN_PROVIDER_PRIVATE_KEY ||
      process.env.SUBSCRIPTION_BILLER_PRIVATE_KEY,
  );
}

function loadEnvValueFromFile(
  filePath: string,
  key: string,
): string | undefined {
  try {
    if (!fs.existsSync(filePath)) return undefined;
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx === -1) continue;
      const k = trimmed.slice(0, idx).trim();
      if (k !== key) continue;
      let value = trimmed.slice(idx + 1).trim();
      if (
        (value.startsWith("\"") && value.endsWith("\"")) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      return value;
    }
  } catch {
    // Ignore file parse issues and continue with other sources.
  }
  return undefined;
}

function loadEnvValueFromLocalFallbacks(key: string): string | undefined {
  // Development convenience: support keys placed in common local env files.
  // This prevents confusion when the dashboard route is launched from a
  // different working directory than where the key was edited.
  const cwd = process.cwd();
  const candidatePaths = [
    path.join(cwd, "apps/arcen-dashboard/.env.local"),
    path.join(cwd, "apps/arcen-dashboard/.env"),
    path.join(cwd, "apps/facilitator/.env.local"),
    path.join(cwd, "apps/facilitator/.env"),
    path.join(cwd, ".env.local"),
    path.join(cwd, ".env"),
    path.join(cwd, "../.env"),
    path.join(cwd, "../../.env"),
    path.join(cwd, "../facilitator/.env"),
  ];

  for (const file of candidatePaths) {
    const value = loadEnvValueFromFile(file, key);
    if (value && value.trim().length > 0) return value;
  }
  return undefined;
}

function getPlanFactoryOwnerPrivateKey(): `0x${string}` | null {
  const configuredOwnerAddress = normalizeAddress(
    process.env.PLAN_FACTORY_OWNER_ADDRESS,
  );

  const preferredOwnerKey = normalizePrivateKey(
    process.env.PLAN_FACTORY_OWNER_PRIVATE_KEY ||
      process.env.OWNER_PRIVATE_KEY ||
      loadEnvValueFromLocalFallbacks("PLAN_FACTORY_OWNER_PRIVATE_KEY") ||
      loadEnvValueFromLocalFallbacks("OWNER_PRIVATE_KEY"),
  );
  if (preferredOwnerKey) return preferredOwnerKey;

  // Optional fallback: allow DEPLOYER_PRIVATE_KEY only if it matches the
  // configured owner address (or owner address is not specified).
  const deployerKey = normalizePrivateKey(
    process.env.DEPLOYER_PRIVATE_KEY ||
      loadEnvValueFromLocalFallbacks("DEPLOYER_PRIVATE_KEY"),
  );
  if (!deployerKey) return null;
  if (!configuredOwnerAddress) return deployerKey;

  const deployerAddress = privateKeyToAccount(deployerKey).address;
  return deployerAddress.toLowerCase() === configuredOwnerAddress.toLowerCase()
    ? deployerKey
    : null;
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
  const managedProviderKey = getManagedProviderPrivateKey();
  const managedProviderAccount = managedProviderKey
    ? privateKeyToAccount(managedProviderKey)
    : null;
  const providerAddress = managedProviderAccount?.address ?? userAddress ?? null;
  const requiresUserSignature = !managedProviderAccount;

  if (requiresUserSignature) {
    if (!auth.team.walletAddress) {
      return NextResponse.json(
        {
          error:
            "No wallet linked to this account. Please link your wallet first.",
        },
        { status: 400 },
      );
    }

    if (!userAddress || !signature || !deadline) {
      return NextResponse.json(
        { error: "signature, deadline, and userAddress are required." },
        { status: 400 },
      );
    }

    if (auth.team.walletAddress.toLowerCase() !== userAddress.toLowerCase()) {
      return NextResponse.json(
        { error: "Signature must be from your authenticated wallet" },
        { status: 403 },
      );
    }
  }

  if (!providerAddress) {
    return NextResponse.json(
      { error: "No provider address is available for on-chain registration." },
      { status: 400 },
    );
  }

  const plan = await db.catalogPlan.findFirst({
    where: { id: planId, teamId: auth.team.teamId },
  });

  if (!plan) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }

  // Free plans cannot be registered on-chain (PlanFactory requires price > 0)
  if (parseFloat(plan.price.toString()) === 0) {
    // Fix the chainSyncStatus if it was incorrectly set
    await db.catalogPlan.update({
      where: { id: plan.id },
      data: { chainSyncStatus: "NOT_APPLICABLE" },
    });
    return NextResponse.json(
      { error: "Free plans cannot be registered on-chain. The PlanFactory contract requires price > 0. Free plan access is managed off-chain." },
      { status: 400 },
    );
  }

  const chainId = resolveDefaultChainId(plan.environmentMode);
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

  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });

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

  let nonce: bigint | null = null;
  if (requiresUserSignature) {
    nonce = await publicClient.readContract({
      address: planFactoryAddress,
      abi: CREATE_PLAN_FOR_ABI,
      functionName: "nonces",
      args: [providerAddress as `0x${string}`],
    });

    const isValidSig = await verifyTypedData({
      address: providerAddress as `0x${string}`,
      domain: {
        ...PLAN_FACTORY_DOMAIN,
        chainId: BigInt(chainId),
        verifyingContract: planFactoryAddress,
      },
      types: CREATE_PLAN_TYPES,
      primaryType: "CreatePlan",
      message: {
        provider: providerAddress as `0x${string}`,
        name: plan.name,
        tier: plan.tier,
        price: priceInUsdc,
        billingInterval: billingIntervalSeconds,
        acceptedToken: usdcAddress,
        metadataURI: "",
        nonce,
        deadline: BigInt(deadline as number),
      },
      signature: signature as `0x${string}`,
    });

    if (!isValidSig) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  // Mark as pending before submission so UI reflects in-progress state
  await db.catalogPlan.update({
    where: { id: planId },
    data: { chainSyncStatus: "PENDING", chainSyncError: null },
  });

  // Check if the selected on-chain provider is registered
  const isProviderRegistered = await publicClient
    .readContract({
      address: planFactoryAddress,
      abi: PROVIDER_REGISTRY_ABI,
      functionName: "isProvider",
      args: [providerAddress as `0x${string}`],
    })
    .catch(() => false as boolean);

  if (!isProviderRegistered) {
    // Try to register the provider if we have the owner key
    const ownerKey = getPlanFactoryOwnerPrivateKey();

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
        args: [providerAddress as `0x${string}`],
      });
      await db.catalogPlan.update({
        where: { id: planId },
        data: {
          chainSyncStatus: "FAILED",
          chainSyncError: `Configured provider wallet is not registered.${ownerHint} Owner action required: execute registerProvider(${providerAddress}) from owner/multisig.`,
        },
      });
      return NextResponse.json(
        {
          error: `Configured provider wallet is not a registered provider.${ownerHint} Contact the platform admin or execute owner registration via Safe/multisig.`,
          relayerAddress: providerAddress,
          providerAddress,
          planFactoryOwner,
          ownerActionRequired: {
            description:
              "Execute registerProvider(providerAddress) on PlanFactory from owner wallet/multisig.",
            target: planFactoryAddress,
            value: "0",
            data: registerProviderCalldata,
            functionSignature: "registerProvider(address)",
            args: [providerAddress],
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
        const registerProviderCalldata = encodeFunctionData({
          abi: PROVIDER_REGISTRY_ABI,
          functionName: "registerProvider",
          args: [providerAddress as `0x${string}`],
        });
        await db.catalogPlan.update({
          where: { id: planId },
          data: {
            chainSyncStatus: "FAILED",
            chainSyncError: `PLAN_FACTORY_OWNER_PRIVATE_KEY resolves to ${ownerAccount.address} but on-chain owner is ${planFactoryOwner}. Owner action required: execute registerProvider(${providerAddress}) from owner/multisig.`,
          },
        });
        return NextResponse.json(
          {
            error: `Owner key mismatch: configured owner key resolves to ${ownerAccount.address}, but on-chain owner is ${planFactoryOwner}. Execute registerProvider(${providerAddress}) from the owner wallet/multisig, then retry.`,
            relayerAddress: providerAddress,
            providerAddress,
            planFactoryOwner,
            ownerActionRequired: {
              description:
                "Execute registerProvider(providerAddress) on PlanFactory from owner wallet/multisig.",
              target: planFactoryAddress,
              value: "0",
              data: registerProviderCalldata,
              functionSignature: "registerProvider(address)",
              args: [providerAddress],
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

      const ownerWallet = createWalletClient({
        account: ownerAccount,
        chain,
        transport: http(rpcUrl),
      });
      const regTxHash = await ownerWallet.writeContract({
        address: planFactoryAddress,
        abi: PROVIDER_REGISTRY_ABI,
        functionName: "registerProvider",
        args: [providerAddress as `0x${string}`],
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

  // Create the plan using either the managed provider signer or user-signed relayer flow.
  let txHash: `0x${string}`;
  try {
    if (managedProviderAccount) {
      const providerWalletClient = createWalletClient({
        account: managedProviderAccount,
        chain,
        transport: http(rpcUrl),
      });
      txHash = await providerWalletClient.writeContract({
        address: planFactoryAddress,
        abi: PlanFactoryABI,
        functionName: "createPlan",
        args: [
          plan.name,
          plan.tier,
          priceInUsdc,
          billingIntervalSeconds,
          usdcAddress,
          "",
        ],
      });
    } else {
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
      const relayerAccount = privateKeyToAccount(relayerPrivateKey);
      const walletClient = createWalletClient({
        account: relayerAccount,
        chain,
        transport: http(rpcUrl),
      });

      txHash = await walletClient.writeContract({
        address: planFactoryAddress,
        abi: CREATE_PLAN_FOR_ABI,
        functionName: "createPlanFor",
        args: [
          providerAddress as `0x${string}`,
          plan.name,
          plan.tier,
          priceInUsdc,
          billingIntervalSeconds,
          usdcAddress,
          "",
          BigInt(deadline as number),
          signature as `0x${string}`,
        ],
      });
    }
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
      relayer: managedProviderAccount?.address ?? "meta-tx relayer",
      planOwner: providerAddress,
      registrationMode: managedProviderAccount ? "managed_provider" : "signed_meta_tx",
    },
  });

  return NextResponse.json({
    ok: true,
    txHash,
    plan: updatedPlan,
    planOwner: providerAddress,
    signingRequired: !managedProviderAccount,
  });
}
