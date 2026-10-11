import type { Context } from "hono";
import { db } from "../../../db.js";
import { requirePermission, isErrorResponse } from "../../../lib/auth/api-auth.js";
import { writeAuditEvent } from "../../../lib/platform/audit.js";
import { createResilientPublicClient, getRpcUrl } from "../../../config.js";
import { isSupportedDashboardChainId } from "../../../lib/platform/default-chain.js";
import { resolveChainFamilyForPrisma } from "../../../lib/platform/chain-family.js";
import { resolvePlanNetwork } from "../../../lib/catalog/plan-network.js";
import { syncPlatformBillingPlanFromCatalogPlan } from "../../../lib/billing/platform-tier-billing.js";
import {
  createPublicClient,
  encodeFunctionData,
  http,
  verifyTypedData,
} from "viem";
import {
  PlanFactoryABI,
  getChain,
  getContractAddresses,
  isEvmChain,
  isSolanaChainId,
  getSolanaRpcUrl,
  getStellarSorobanRpcUrl,
  getStellarNetworkPassphrase,
} from "@arcenpay/internal-core";
import { Connection } from "@solana/web3.js";
import { decodePlanRecord, findPlanPda } from "@arcenpay/internal-core/solana";
import { rpc, contract as stellarContract } from "@stellar/stellar-sdk";
import { z } from "zod";

const RegisterOnChainSchema = z.object({
  signature: z
    .string()
    .regex(/^0x[0-9a-fA-F]+$/)
    .optional(),
  deadline: z.number().int().positive().optional(),
  userAddress: z.string().optional(),
  onChainPlanId: z.string().optional(),
  txHash: z.string().optional(),
});

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

const UPDATE_PLAN_TYPES = {
  UpdatePlan: [
    { name: "provider", type: "address" },
    { name: "planId", type: "uint256" },
    { name: "price", type: "uint256" },
    { name: "metadataURI", type: "string" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

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

const UPDATE_PLAN_FOR_ABI = [
  {
    inputs: [
      { name: "provider", type: "address" },
      { name: "planId", type: "uint256" },
      { name: "price", type: "uint256" },
      { name: "metadataURI", type: "string" },
      { name: "deadline", type: "uint256" },
      { name: "signature", type: "bytes" },
    ],
    name: "updatePlanFor",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

function sameAddress(a: string, b: string, chainId: number): boolean {
  if (isEvmChain(chainId)) {
    return a.toLowerCase() === b.toLowerCase();
  }
  return a === b;
}

function resolveMaxOnChainChargeMicros(plan: {
  price: { toString(): string };
  annualPrice?: { toString(): string } | string | null;
}): bigint {
  const monthlyMicros = Math.round(parseFloat(plan.price.toString()) * 1_000_000);
  const annualMicros = Math.round(
    parseFloat(String(plan.annualPrice ?? "0")) * 1_000_000,
  );
  // The on-chain plan price is the charge per billing interval.
  // Use the maximum of monthly and annual so the signature matches
  // what the frontend signs (the SDK's resolveMaxOnChainChargeMicros
  // also takes the max). This ensures EIP-712 signature verification
  // succeeds regardless of which billing interval the user selected.
  return BigInt(Math.max(monthlyMicros, annualMicros, 0));
}

export async function registerPlanOnChain(c: Context) {
  const auth = await requirePermission(c, "catalog:write");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const planId = c.req.param("id");

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400 as any);
  }

  const parsed = RegisterOnChainSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors }, 400 as any);
  }

  const { signature, deadline, userAddress, onChainPlanId, txHash } = parsed.data;

  const storedPlan = await db.catalogPlan.findFirst({
    where: { id: planId, teamId: auth.team.teamId },
    include: {
      environment: {
        select: {
          mode: true,
          chainId: true,
        },
      },
    },
  });

  if (!storedPlan) {
    return c.json({ error: "Plan not found" }, 404 as any);
  }

  const resolvedNetwork = resolvePlanNetwork({
    environmentMode: storedPlan.environment?.mode ?? "DEVELOPMENT",
    acceptedToken: storedPlan.acceptedToken,
    requestedChainId: storedPlan.environment?.chainId,
  });

  if (!resolvedNetwork) {
    return c.json({
      error:
        "Plan has an invalid billing network configuration. Update the plan and try again.",
    }, 400 as any);
  }

  const chainId = resolvedNetwork.chainId;
  const providerAddress = isEvmChain(chainId)
    ? auth.team.walletAddress
    : isSolanaChainId(chainId)
      ? auth.team.solanaWalletAddress
      : auth.team.stellarWalletAddress;

  if (!providerAddress) {
    return c.json({ error: "No provider wallet is available for on-chain registration." }, 400 as any);
  }

  const tokenMismatch = isEvmChain(storedPlan.chainId)
    ? storedPlan.acceptedToken.toLowerCase() !== resolvedNetwork.acceptedToken.toLowerCase()
    : storedPlan.acceptedToken !== resolvedNetwork.acceptedToken;

  const needsPlanRepair =
    !storedPlan.onChainPlanId &&
    (storedPlan.chainId !== resolvedNetwork.chainId || tokenMismatch);

  const plan = needsPlanRepair
    ? await db.catalogPlan.update({
        where: { id: storedPlan.id },
        data: {
          chainId: resolvedNetwork.chainId,
          chainFamily: resolveChainFamilyForPrisma(resolvedNetwork.chainId),
          acceptedToken: resolvedNetwork.acceptedToken,
          chainSyncStatus:
            parseFloat(storedPlan.price.toString()) === 0
              ? "NOT_APPLICABLE"
              : "PENDING",
          chainSyncError: null,
          chainSyncedAt: null,
        },
      })
    : storedPlan;

  if (parseFloat(plan.price.toString()) === 0) {
    await db.catalogPlan.update({
      where: { id: plan.id },
      data: { chainSyncStatus: "NOT_APPLICABLE" },
    });
    return c.json({
        error:
          "Free plans cannot be registered on-chain. The PlanFactory contract requires price > 0. Free plan access is managed off-chain.",
      }, 400 as any);
  }

  if (plan.status === "DRAFT") {
    await db.catalogPlan.update({
      where: { id: planId },
      data: { status: "PUBLISHED", publishedAt: new Date() },
    });
  }

  if (!isSupportedDashboardChainId(plan.chainId)) {
    return c.json(
      { error: `Plan chain ${plan.chainId} is not supported by this deployment.` },
      400 as any,
    );
  }

  // ── Solana confirmation path ───────────────────────────────────────────────
  if (isSolanaChainId(chainId)) {
    if (!onChainPlanId) {
      return c.json({ error: "onChainPlanId is required for Solana confirmation." }, 400 as any);
    }
    if (!txHash) {
      return c.json({ error: "txHash is required for Solana confirmation." }, 400 as any);
    }

    const rpcUrl = getSolanaRpcUrl(chainId);
    const programId = getContractAddresses(chainId).planFactory;
    try {
      const connection = new Connection(rpcUrl, "confirmed");
      const tx = await connection.getParsedTransaction(txHash, {
        maxSupportedTransactionVersion: 0,
        commitment: "confirmed",
      });
      if (!tx) {
        return c.json({ error: "Solana transaction is not confirmed yet." }, 425 as any);
      }
      if (tx.meta?.err) {
        return c.json({ error: "Solana transaction failed on-chain." }, 409 as any);
      }

      const invoked = (tx.transaction.message.accountKeys ?? []).some((k: any) => {
        const pk =
          typeof k?.pubkey?.toBase58 === "function"
            ? k.pubkey.toBase58()
            : String(k?.pubkey ?? k);
        return pk === programId;
      });
      if (!invoked) {
        return c.json(
          { error: "Transaction did not invoke the ArcenPay Solana program." },
          409 as any,
        );
      }

      const [planPda] = findPlanPda(programId, BigInt(onChainPlanId));
      const accountInfo = await connection.getAccountInfo(planPda, "confirmed");
      if (!accountInfo) {
        return c.json({ error: `Plan ${onChainPlanId} not found on-chain.` }, 404 as any);
      }
      const onChainPlan = decodePlanRecord(Buffer.from(accountInfo.data));
      if (!onChainPlan) {
        return c.json({ error: "Unable to decode the on-chain plan account." }, 500 as any);
      }

      const priceMicros = BigInt(
        Math.round(parseFloat(plan.price.toString()) * 1_000_000),
      );
      if (
        onChainPlan.provider !== providerAddress ||
        onChainPlan.price !== priceMicros ||
        Number(onChainPlan.billingInterval) !== plan.billingInterval ||
        onChainPlan.acceptedToken !== plan.acceptedToken ||
        !onChainPlan.active
      ) {
        return c.json(
          { error: "On-chain plan details do not match the catalog plan." },
          409 as any,
        );
      }

      const updated = await db.catalogPlan.update({
        where: { id: plan.id },
        data: {
          onChainPlanId,
          chainSyncStatus: "SYNCED",
          chainSyncError: null,
          chainSyncedAt: new Date(),
        },
      });

      await syncPlatformBillingPlanFromCatalogPlan(plan.id).catch((error) => {
        console.warn("[plan-register-onchain] Platform billing sync failed:", error);
      });

      await writeAuditEvent({
        headers: c.req.raw.headers,
        teamId: auth.team.teamId,
        userId: auth.team.userId,
        walletAddress: providerAddress,
        action: "PLAN_REGISTERED_ON_CHAIN",
        resourceType: "CatalogPlan",
        resourceId: plan.id,
        metadata: {
          chainId,
          onChainPlanId,
          txHash: txHash ?? null,
          family: "solana",
        },
      });

      return c.json({
        success: true,
        onChainPlanId: updated.onChainPlanId,
        status: updated.chainSyncStatus,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[plan-register-onchain] Solana verification failed:", msg);
      return c.json({ error: `Solana verification failed: ${msg}` }, 500 as any);
    }
  }

  // ── Stellar Soroban confirmation path ──────────────────────────────────────
  if (!isEvmChain(chainId)) {
    if (!onChainPlanId) {
      return c.json({ error: "onChainPlanId is required for Stellar confirmation." }, 400 as any);
    }

    const sorobanRpcUrl = getStellarSorobanRpcUrl(chainId);
    const networkPassphrase = getStellarNetworkPassphrase(chainId);
    const contracts = getContractAddresses(chainId);

    try {
      const client = (await stellarContract.Client.from({
        contractId: contracts.planFactory,
        networkPassphrase,
        rpcUrl: sorobanRpcUrl,
      })) as any;

      const { result: onChainPlan } = await client.get_plan({
        plan_id: BigInt(onChainPlanId),
      });

      if (!onChainPlan) {
        return c.json({ error: `Plan ${onChainPlanId} not found on-chain.` }, 404 as any);
      }

      const onChainProvider = String(onChainPlan.provider ?? "");
      const onChainName = String(onChainPlan.name ?? "");
      const onChainTier = String(onChainPlan.tier ?? "");
      const onChainPrice = BigInt(onChainPlan.price ?? 0);
      const onChainInterval = Number(onChainPlan.billing_interval ?? 0);
      const onChainToken = String(onChainPlan.accepted_token ?? "");
      const onChainActive = Boolean(onChainPlan.active ?? false);

      const priceInMicros = resolveMaxOnChainChargeMicros(plan);

      if (
        onChainProvider !== providerAddress ||
        onChainName !== plan.name ||
        onChainTier !== plan.tier ||
        onChainPrice !== priceInMicros ||
        onChainInterval !== plan.billingInterval ||
        onChainToken !== plan.acceptedToken ||
        !onChainActive
      ) {
        return c.json(
          { error: "On-chain plan details do not match the catalog plan." },
          409 as any,
        );
      }

      const updated = await db.catalogPlan.update({
        where: { id: plan.id },
        data: {
          onChainPlanId,
          chainSyncStatus: "SYNCED",
          chainSyncError: null,
          chainSyncedAt: new Date(),
        },
      });

      await syncPlatformBillingPlanFromCatalogPlan(plan.id).catch((error) => {
        console.warn("[plan-register-onchain] Platform billing sync failed:", error);
      });

      await writeAuditEvent({
        headers: c.req.raw.headers,
        teamId: auth.team.teamId,
        userId: auth.team.userId,
        walletAddress: providerAddress,
        action: "PLAN_REGISTERED_ON_CHAIN",
        resourceType: "CatalogPlan",
        resourceId: plan.id,
        metadata: {
          chainId,
          onChainPlanId,
          txHash: txHash ?? null,
          family: "stellar",
        },
      });

      return c.json({
        success: true,
        onChainPlanId: updated.onChainPlanId,
        status: updated.chainSyncStatus,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[plan-register-onchain] Stellar verification failed:", msg);
      return c.json({ error: `Stellar verification failed: ${msg}` }, 500 as any);
    }
  }

  // ── EVM path (signature verification + on-chain write) ───────────────────
  const requiresUserSignature = true;

  if (requiresUserSignature) {
    if (!userAddress || !signature || !deadline) {
      return c.json({ error: "signature, deadline, and userAddress are required." }, 400 as any);
    }

    if (providerAddress.toLowerCase() !== userAddress.toLowerCase()) {
      return c.json({ error: "Signature must be from your authenticated wallet" }, 403 as any);
    }
  }

  const rpcUrl = getRpcUrl(chainId);
  const chain = getChain(chainId);

  const contracts = getContractAddresses(chainId);
  const planFactoryAddress = contracts.planFactory as `0x${string}`;

  if (
    !planFactoryAddress ||
    planFactoryAddress === "0x0000000000000000000000000000000000000000"
  ) {
    return c.json({ error: "PlanFactory not deployed on this chain" }, 503 as any);
  }

  const publicClient = createResilientPublicClient(chainId);

  const priceInUsdc = resolveMaxOnChainChargeMicros(plan);
  // CatalogPlan.billingInterval is persisted in seconds and maps directly to
  // PlanFactory's uint32 billingInterval field.
  const billingIntervalSeconds = plan.billingInterval;
  let shouldReplaceOnChainPlan = false;
  let replacedOnChainPlanId: string | null = null;
  const usdcAddress = plan.onChainPlanId
    ? plan.acceptedToken
    : resolvedNetwork.acceptedToken;

  if (plan.onChainPlanId) {
    const onChainPlanId = BigInt(plan.onChainPlanId);
    let onChainPlan: {
      id: bigint;
      provider: `0x${string}`;
      name: string;
      tier: string;
      price: bigint;
      billingInterval: number;
      acceptedToken: string;
      active: boolean;
      metadataURI: string;
    };

    try {
      onChainPlan = (await publicClient.readContract({
        address: planFactoryAddress,
        abi: PlanFactoryABI,
        functionName: "getPlan",
        args: [onChainPlanId],
      })) as typeof onChainPlan;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to query on-chain plan";
      const isRateLimited =
        message.includes("request limit reached") ||
        message.includes("429") ||
        message.includes("rate limit");
      const status = isRateLimited ? 429 : 503;
      const cleanMessage = isRateLimited
        ? "RPC node rate limit reached. Please wait a few seconds and try again."
        : `RPC node error when reading on-chain plan: ${message}`;
      return c.json({ error: cleanMessage }, status as any);
    }

    if (!sameAddress(onChainPlan.provider, providerAddress, chainId)) {
      const message = `Configured provider wallet ${providerAddress} does not own on-chain plan ${plan.onChainPlanId}. Current owner is ${onChainPlan.provider}.`;
      await db.catalogPlan.update({
        where: { id: planId },
        data: { chainSyncStatus: "FAILED", chainSyncError: message },
      });
      return c.json({ error: message }, 409 as any);
    }

    const immutableMismatches: string[] = [];
    if (onChainPlan.name !== plan.name) immutableMismatches.push("name");
    if (onChainPlan.tier !== plan.tier) immutableMismatches.push("tier");
    if (Number(onChainPlan.billingInterval) !== billingIntervalSeconds) {
      immutableMismatches.push("billing interval");
    }
    if (!sameAddress(onChainPlan.acceptedToken, usdcAddress, chainId)) {
      immutableMismatches.push("accepted token");
    }

    if (immutableMismatches.length > 0) {
      const activeSubscriberCount = await db.subscriptionState.count({
        where: {
          teamId: auth.team.teamId,
          catalogPlanId: plan.id,
          status: { in: ["ACTIVE", "PAST_DUE"] },
        },
      });

      if (activeSubscriberCount > 0) {
        const message = `On-chain plan ${plan.onChainPlanId} can only sync price updates. These fields differ from the on-chain plan: ${immutableMismatches.join(", ")}. This plan already has ${activeSubscriberCount} active subscriber(s), so create a new plan instead of replacing the on-chain plan.`;
        await db.catalogPlan.update({
          where: { id: planId },
          data: { chainSyncStatus: "FAILED", chainSyncError: message },
        });
        return c.json({ error: message }, 409 as any);
      }

      shouldReplaceOnChainPlan = true;
      replacedOnChainPlanId = plan.onChainPlanId;
    } else if (onChainPlan.price === priceInUsdc) {
      const syncedPlan = await db.catalogPlan.update({
        where: { id: planId },
        data: {
          chainSyncStatus: "SYNCED",
          chainSyncError: null,
          chainSyncedAt: new Date(),
        },
      });

      await writeAuditEvent({
        headers: c.req.raw.headers,
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

      return c.json({
        ok: true,
        noOp: true,
        onChainPlanId: plan.onChainPlanId,
        plan: syncedPlan,
        planOwner: providerAddress,
        signingRequired: false,
      });
    }

    if (!shouldReplaceOnChainPlan) {
      const updateNonce = await publicClient.readContract({
        address: planFactoryAddress,
        abi: CREATE_PLAN_FOR_ABI,
        functionName: "nonces",
        args: [providerAddress as `0x${string}`],
      });

      const isValidUpdateSig = await verifyTypedData({
        address: providerAddress as `0x${string}`,
        domain: {
          ...PLAN_FACTORY_DOMAIN,
          chainId: BigInt(chainId),
          verifyingContract: planFactoryAddress,
        },
        types: UPDATE_PLAN_TYPES,
        primaryType: "UpdatePlan",
        message: {
          provider: providerAddress as `0x${string}`,
          planId: onChainPlanId,
          price: priceInUsdc,
          metadataURI: "",
          nonce: updateNonce,
          deadline: BigInt(deadline as number),
        },
        signature: signature as `0x${string}`,
      });

      if (!isValidUpdateSig) {
        return c.json({ error: "Invalid signature" }, 401 as any);
      }

      const updatePlanForCalldata = encodeFunctionData({
        abi: UPDATE_PLAN_FOR_ABI,
        functionName: "updatePlanFor",
        args: [
          providerAddress as `0x${string}`,
          onChainPlanId,
          priceInUsdc,
          "",
          BigInt(deadline as number),
          signature as `0x${string}`,
        ],
      });

      const preparedPlan = await db.catalogPlan.update({
        where: { id: planId },
        data: { chainSyncStatus: "PENDING", chainSyncError: null },
      });

      await writeAuditEvent({
        headers: c.req.raw.headers,
        teamId: auth.team.teamId,
        userId: auth.team.userId,
        walletAddress: auth.team.walletAddress,
        action: "catalog.plan.chain_sync_prepared",
        resourceType: "CatalogPlan",
        resourceId: planId,
        metadata: {
          onChainPlanId: plan.onChainPlanId,
          planOwner: providerAddress,
          registrationMode: "user_controlled_update",
          transport: "prepared_call",
          target: planFactoryAddress,
        },
      });

      return c.json({
        ok: true,
        onChainPlanId: plan.onChainPlanId,
        plan: preparedPlan,
        planOwner: providerAddress,
        providerAddress,
        signingRequired: true,
        preparedTransaction: {
          target: planFactoryAddress,
          value: "0",
          data: updatePlanForCalldata,
          executionMode: "smart-account",
          functionSignature:
            "updatePlanFor(address,uint256,uint256,string,uint256,bytes)",
        },
      });
    }
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
        acceptedToken: usdcAddress as `0x${string}`,
        metadataURI: "",
        nonce,
        deadline: BigInt(deadline as number),
      },
      signature: signature as `0x${string}`,
    });

    if (!isValidSig) {
      return c.json({ error: "Invalid signature" }, 401 as any);
    }
  }

  await db.catalogPlan.update({
    where: { id: planId },
    data: { chainSyncStatus: "PENDING", chainSyncError: null },
  });

  const createPlanForCalldata = encodeFunctionData({
    abi: CREATE_PLAN_FOR_ABI,
    functionName: "createPlanFor",
    args: [
      providerAddress as `0x${string}`,
      plan.name,
      plan.tier,
      priceInUsdc,
      billingIntervalSeconds,
      usdcAddress as `0x${string}`,
      "",
      BigInt(deadline as number),
      signature as `0x${string}`,
    ],
  });

  const preparedPlan = await db.catalogPlan.update({
    where: { id: planId },
    data: {
      chainId,
      chainSyncStatus: "PENDING",
      chainTxHash: null,
      chainSyncError: null,
      chainSyncedAt: null,
    },
  });

  await writeAuditEvent({
    headers: c.req.raw.headers,
    teamId: auth.team.teamId,
    userId: auth.team.userId,
    walletAddress: auth.team.walletAddress,
    action: "catalog.plan.chain_sync_prepared",
    resourceType: "CatalogPlan",
    resourceId: planId,
    metadata: {
      planOwner: providerAddress,
      registrationMode: replacedOnChainPlanId
        ? "user_controlled_replacement"
        : "user_controlled",
      ...(replacedOnChainPlanId ? { replacedOnChainPlanId } : {}),
      transport: "prepared_call",
      target: planFactoryAddress,
    },
  });

  return c.json({
    ok: true,
    plan: preparedPlan,
    planOwner: providerAddress,
    providerAddress,
    signingRequired: true,
    preparedTransaction: {
      target: planFactoryAddress,
      value: "0",
      data: createPlanForCalldata,
      executionMode: "smart-account",
      functionSignature:
        "createPlanFor(address,string,string,uint256,uint32,address,string,uint256,bytes)",
    },
  });
}
