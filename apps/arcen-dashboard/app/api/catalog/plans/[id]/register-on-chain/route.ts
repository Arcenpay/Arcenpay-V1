import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission, isErrorResponse } from "@/lib/api-auth";
import { writeAuditEvent } from "@/lib/audit";
import { getRpcUrl } from "@/lib/config";
import { DEFAULT_CHAIN_ID } from "@/lib/default-chain";
import {
  createWalletClient,
  createPublicClient,
  encodeFunctionData,
  http,
  parseEventLogs,
  verifyTypedData,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { PlanFactoryABI, getChain, getContractAddresses, TOKENS } from "@arcenpay/sdk";
import { isAddress } from "viem";
import { z } from "zod";

// Allow up to 60 s on Vercel (long enough to wait for tx confirmation)
export const maxDuration = 60;

// Request schema for EIP-712 signed plan registration
const RegisterOnChainSchema = z.object({
  signature: z
    .string()
    .regex(/^0x[0-9a-fA-F]+$/)
    .optional(),
  deadline: z.number().int().positive().optional(),
  userAddress: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .optional(),
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

function getManagedProviderPrivateKey(): `0x${string}` | null {
  return normalizePrivateKey(
    process.env.ONCHAIN_PROVIDER_PRIVATE_KEY ||
      process.env.SUBSCRIPTION_BILLER_PRIVATE_KEY,
  );
}

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
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
  const providerAddress =
    managedProviderAccount?.address ?? userAddress ?? null;
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
      {
        error:
          "Free plans cannot be registered on-chain. The PlanFactory contract requires price > 0. Free plan access is managed off-chain.",
      },
      { status: 400 },
    );
  }

  const chainId = DEFAULT_CHAIN_ID;
  const rpcUrl = getRpcUrl(chainId);
  const chain = getChain(chainId);

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

  if (plan.onChainPlanId) {
    const onChainPlanId = BigInt(plan.onChainPlanId);
    const onChainPlan = (await publicClient.readContract({
      address: planFactoryAddress,
      abi: PlanFactoryABI,
      functionName: "getPlan",
      args: [onChainPlanId],
    })) as {
      id: bigint;
      provider: `0x${string}`;
      name: string;
      tier: string;
      price: bigint;
      billingInterval: number;
      acceptedToken: `0x${string}`;
      active: boolean;
      metadataURI: string;
    };

    if (!sameAddress(onChainPlan.provider, providerAddress)) {
      const message = `Configured provider wallet ${providerAddress} does not own on-chain plan ${plan.onChainPlanId}. Current owner is ${onChainPlan.provider}.`;
      await db.catalogPlan.update({
        where: { id: planId },
        data: { chainSyncStatus: "FAILED", chainSyncError: message },
      });
      return NextResponse.json({ error: message }, { status: 409 });
    }

    const immutableMismatches: string[] = [];
    if (onChainPlan.name !== plan.name) immutableMismatches.push("name");
    if (onChainPlan.tier !== plan.tier) immutableMismatches.push("tier");
    if (Number(onChainPlan.billingInterval) !== billingIntervalSeconds) {
      immutableMismatches.push("billing interval");
    }
    if (!sameAddress(onChainPlan.acceptedToken, usdcAddress)) {
      immutableMismatches.push("accepted token");
    }

    if (immutableMismatches.length > 0) {
      const message = `On-chain plan ${plan.onChainPlanId} can only sync price updates. These fields differ from the on-chain plan: ${immutableMismatches.join(", ")}. Create a new plan to change them.`;
      await db.catalogPlan.update({
        where: { id: planId },
        data: { chainSyncStatus: "FAILED", chainSyncError: message },
      });
      return NextResponse.json({ error: message }, { status: 409 });
    }

    if (onChainPlan.price === priceInUsdc) {
      const syncedPlan = await db.catalogPlan.update({
        where: { id: planId },
        data: {
          chainSyncStatus: "SYNCED",
          chainSyncError: null,
          chainSyncedAt: new Date(),
        },
      });

      await writeAuditEvent({
        request,
        teamId: auth.team.teamId,
        userId: auth.team.userId,
        walletAddress: auth.team.walletAddress,
        action: "catalog.plan.chain_sync_confirmed",
        resourceType: "CatalogPlan",
        resourceId: planId,
        metadata: {
          onChainPlanId: plan.onChainPlanId,
          syncMode: "already_synced",
          planOwner: providerAddress,
        },
      });

      return NextResponse.json({
        ok: true,
        noOp: true,
        onChainPlanId: plan.onChainPlanId,
        plan: syncedPlan,
        planOwner: providerAddress,
        signingRequired: false,
      });
    }

    await db.catalogPlan.update({
      where: { id: planId },
      data: { chainSyncStatus: "PENDING", chainSyncError: null },
    });

    if (!managedProviderAccount) {
      return NextResponse.json(
        {
          error:
            "This plan already exists on-chain. Price updates must be sent from the provider wallet because PlanFactory.updatePlan is not relayer-signable.",
          providerAddress,
          signingRequired: true,
        },
        { status: 409 },
      );
    }

    let txHash: `0x${string}`;
    try {
      const providerWalletClient = createWalletClient({
        account: managedProviderAccount,
        chain,
        transport: http(rpcUrl),
      });
      txHash = await providerWalletClient.writeContract({
        address: planFactoryAddress,
        abi: PlanFactoryABI,
        functionName: "updatePlan",
        args: [onChainPlanId, priceInUsdc, onChainPlan.metadataURI ?? ""],
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

    let confirmedOnChain = false;
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

      confirmedOnChain = true;
    } catch {
      // Confirmation timed out or receipt fetch failed — tx was submitted.
    }

    const updatedPlan = await db.catalogPlan.update({
      where: { id: planId },
      data: {
        chainSyncStatus: confirmedOnChain ? "SYNCED" : "PENDING",
        chainTxHash: txHash,
        chainSyncError: null,
        chainSyncedAt: confirmedOnChain ? new Date() : null,
      },
    });

    await writeAuditEvent({
      request,
      teamId: auth.team.teamId,
      userId: auth.team.userId,
      walletAddress: auth.team.walletAddress,
      action: confirmedOnChain
        ? "catalog.plan.chain_synced"
        : "catalog.plan.chain_sync_pending",
      resourceType: "CatalogPlan",
      resourceId: planId,
      metadata: {
        txHash,
        onChainPlanId: plan.onChainPlanId,
        relayer: managedProviderAccount.address,
        planOwner: providerAddress,
        registrationMode: "managed_provider_update",
      },
    });

    return NextResponse.json({
      ok: true,
      txHash,
      onChainPlanId: plan.onChainPlanId,
      plan: updatedPlan,
      planOwner: providerAddress,
      signingRequired: false,
    });
  }

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
          userAddress: providerAddress,
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
  let confirmedOnChain = false;
  let decodedOnChainPlanId: string | null = null;
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
    confirmedOnChain = true;

    const planCreatedLogs = parseEventLogs({
      abi: PlanFactoryABI,
      logs: receipt.logs,
      eventName: "PlanCreated",
      strict: false,
    });

    const latestPlanCreatedLog = [...planCreatedLogs].reverse().find((log) => {
      const provider = (log as { args?: { provider?: string } }).args?.provider;
      return (
        typeof provider === "string" &&
        provider.toLowerCase() === providerAddress.toLowerCase()
      );
    });

    const parsedPlanId = (
      latestPlanCreatedLog as { args?: { planId?: bigint } } | undefined
    )?.args?.planId;

    if (typeof parsedPlanId === "bigint") {
      decodedOnChainPlanId = parsedPlanId.toString();
    }

    if (!decodedOnChainPlanId) {
      const providerPlans = (await publicClient.readContract({
        address: planFactoryAddress,
        abi: PlanFactoryABI,
        functionName: "getProviderPlans",
        args: [providerAddress as `0x${string}`],
      })) as bigint[];
      const latestProviderPlan = providerPlans.at(-1);
      if (typeof latestProviderPlan === "bigint") {
        decodedOnChainPlanId = latestProviderPlan.toString();
      }
    }
  } catch {
    // Confirmation timed out or receipt fetch failed — tx was submitted.
  }

  const updatedPlan = await db.catalogPlan.update({
    where: { id: planId },
    data: {
      chainSyncStatus:
        confirmedOnChain && decodedOnChainPlanId ? "SYNCED" : "PENDING",
      chainTxHash: txHash,
      chainSyncError: null,
      chainSyncedAt:
        confirmedOnChain && decodedOnChainPlanId ? new Date() : null,
      ...(decodedOnChainPlanId ? { onChainPlanId: decodedOnChainPlanId } : {}),
    },
  });

  await writeAuditEvent({
    request,
    teamId: auth.team.teamId,
    userId: auth.team.userId,
    walletAddress: auth.team.walletAddress,
    action: decodedOnChainPlanId
      ? "catalog.plan.chain_synced"
      : "catalog.plan.chain_sync_pending",
    resourceType: "CatalogPlan",
    resourceId: planId,
    metadata: {
      txHash,
      onChainPlanId: decodedOnChainPlanId,
      relayer: managedProviderAccount?.address ?? "meta-tx relayer",
      planOwner: providerAddress,
      registrationMode: managedProviderAccount
        ? "managed_provider"
        : "signed_meta_tx",
    },
  });

  return NextResponse.json({
    ok: true,
    txHash,
    onChainPlanId: decodedOnChainPlanId,
    plan: updatedPlan,
    planOwner: providerAddress,
    signingRequired: !managedProviderAccount,
  });
}
