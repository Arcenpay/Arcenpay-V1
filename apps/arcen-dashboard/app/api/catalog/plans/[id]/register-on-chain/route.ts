import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission, isErrorResponse } from "@/lib/api-auth";
import { writeAuditEvent } from "@/lib/audit";
import { createWalletClient, createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia, base } from "viem/chains";
import { PlanFactoryABI, getContractAddresses, TOKENS } from "@meap/core";
import type { Chain } from "viem";

// Allow up to 60 s on Vercel (long enough to wait for tx confirmation)
export const maxDuration = 60;

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

const CHAIN_MAP: Record<number, Chain> = {
  11155111: sepolia,
  8453: base,
};

type Params = { id: string };

export async function POST(
  request: NextRequest,
  context: { params: Promise<Params> },
) {
  const auth = await requirePermission("catalog:write");
  if (isErrorResponse(auth)) return auth;

  const { id: planId } = await context.params;

  const plan = await db.catalogPlan.findFirst({
    where: { id: planId, teamId: auth.team.teamId },
  });

  if (!plan) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }

  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!privateKey) {
    return NextResponse.json(
      { error: "Server relayer not configured (DEPLOYER_PRIVATE_KEY missing)" },
      { status: 503 },
    );
  }

  const chainId = parseInt(process.env.NEXT_PUBLIC_CHAIN_ID ?? "11155111");
  const rpcUrl =
    process.env.RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
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

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  });

  const priceInUsdc = BigInt(Math.round(parseFloat(plan.price.toString()) * 1_000_000));
  const billingIntervalSeconds = plan.billingInterval * 86400;
  // Use the plan's stored token address if it's a real 0x address,
  // otherwise fall back to the chain's default USDC address.
  const storedToken = plan.acceptedToken;
  const usdcAddress = (
    storedToken.startsWith("0x") && storedToken.length === 42
      ? storedToken
      : (TOKENS[chainId as keyof typeof TOKENS]?.USDC ?? storedToken)
  ) as `0x${string}`;

  // Mark as pending before submission so UI reflects in-progress state
  await db.catalogPlan.update({
    where: { id: planId },
    data: { chainSyncStatus: "PENDING", chainSyncError: null },
  });

  // Auto-register the relayer as a provider if not already registered.
  // registerProvider() is onlyOwner — requires PLAN_FACTORY_OWNER_PRIVATE_KEY
  // (the key used to originally deploy PlanFactory on this chain).
  const isRegistered = await publicClient.readContract({
    address: planFactoryAddress,
    abi: PROVIDER_REGISTRY_ABI,
    functionName: "isProvider",
    args: [account.address],
  }).catch(() => false as boolean);

  if (!isRegistered) {
    const ownerKey = process.env.PLAN_FACTORY_OWNER_PRIVATE_KEY;
    if (!ownerKey) {
      await db.catalogPlan.update({
        where: { id: planId },
        data: {
          chainSyncStatus: "FAILED",
          chainSyncError: "Relayer not registered as provider. Set PLAN_FACTORY_OWNER_PRIVATE_KEY (the PlanFactory owner's private key) in the dashboard .env to auto-register.",
        },
      });
      return NextResponse.json(
        { error: "Relayer wallet is not a registered provider. Add PLAN_FACTORY_OWNER_PRIVATE_KEY (PlanFactory owner key) to .env and restart the server." },
        { status: 503 },
      );
    }

    try {
      const ownerAccount = privateKeyToAccount(ownerKey as `0x${string}`);
      const ownerWallet = createWalletClient({ account: ownerAccount, chain, transport: http(rpcUrl) });
      const regTxHash = await ownerWallet.writeContract({
        address: planFactoryAddress,
        abi: PROVIDER_REGISTRY_ABI,
        functionName: "registerProvider",
        args: [account.address],
      });
      await publicClient.waitForTransactionReceipt({ hash: regTxHash, timeout: 45_000 });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Provider registration failed";
      await db.catalogPlan.update({
        where: { id: planId },
        data: { chainSyncStatus: "FAILED", chainSyncError: message },
      });
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  let txHash: `0x${string}`;
  try {
    txHash = await walletClient.writeContract({
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
    metadata: { txHash, relayer: account.address },
  });

  return NextResponse.json({ ok: true, txHash, plan: updatedPlan });
}
