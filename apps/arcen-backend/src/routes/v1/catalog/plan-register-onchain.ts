import type { Context } from "hono";
import { db } from "../../../db.js";
import { requirePermission, isErrorResponse } from "../../../lib/auth/api-auth.js";
import { writeAuditEvent } from "../../../lib/platform/audit.js";
import { getRpcUrl } from "../../../config.js";
import { isSupportedDashboardChainId } from "../../../lib/platform/default-chain.js";
import { resolvePlanNetwork } from "../../../lib/catalog/plan-network.js";
import {
  createPublicClient,
  encodeFunctionData,
  http,
  verifyTypedData,
} from "viem";
import { PlanFactoryABI, getChain, getContractAddresses } from "@arcenpay/internal-core";
import { z } from "zod";

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

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
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

  const { signature, deadline, userAddress } = parsed.data;
  const providerAddress = auth.team.walletAddress ?? userAddress ?? null;
  const requiresUserSignature = true;

  if (requiresUserSignature) {
    if (!auth.team.walletAddress) {
      return c.json({
          error:
            "No wallet linked to this account. Please link your wallet first.",
        }, 400 as any);
    }

    if (!userAddress || !signature || !deadline) {
      return c.json({ error: "signature, deadline, and userAddress are required." }, 400 as any);
    }

    if (auth.team.walletAddress.toLowerCase() !== userAddress.toLowerCase()) {
      return c.json({ error: "Signature must be from your authenticated wallet" }, 403 as any);
    }
  }

  if (!providerAddress) {
    return c.json({ error: "No provider wallet is available for on-chain registration." }, 400 as any);
  }

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
    environmentMode: storedPlan.environment?.mode ?? storedPlan.environmentMode,
    acceptedToken: storedPlan.acceptedToken,
    requestedChainId: storedPlan.environment?.chainId ?? storedPlan.chainId,
  });
  if (!resolvedNetwork) {
    return c.json({
      error:
        "Plan has an invalid billing network configuration. Update the plan and try again.",
    }, 400 as any);
  }

  const needsPlanRepair =
    !storedPlan.onChainPlanId &&
    (storedPlan.chainId !== resolvedNetwork.chainId ||
      storedPlan.acceptedToken.toLowerCase() !==
        resolvedNetwork.acceptedToken.toLowerCase());

  const plan = needsPlanRepair
    ? await db.catalogPlan.update({
        where: { id: storedPlan.id },
        data: {
          chainId: resolvedNetwork.chainId,
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
  const chainId = plan.chainId;
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

  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });

  const priceInUsdc = BigInt(
    Math.round(parseFloat(plan.price.toString()) * 1_000_000),
  );
  const billingIntervalSeconds = plan.billingInterval * 86400;
  const usdcAddress = plan.onChainPlanId
    ? (plan.acceptedToken as `0x${string}`)
    : resolvedNetwork.acceptedToken;

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
      return c.json({ error: message }, 409 as any);
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
      return c.json({ error: message }, 409 as any);
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
        functionSignature:
          "updatePlanFor(address,uint256,uint256,string,uint256,bytes)",
      },
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
      return c.json({ error: "Invalid signature" }, 401 as any);
    }
  }

  await db.catalogPlan.update({
    where: { id: planId },
    data: { chainSyncStatus: "PENDING", chainSyncError: null },
  });

  const isProviderRegistered = await publicClient
    .readContract({
      address: planFactoryAddress,
      abi: PROVIDER_REGISTRY_ABI,
      functionName: "isProvider",
      args: [providerAddress as `0x${string}`],
    })
    .catch(() => false as boolean);

  if (!isProviderRegistered) {
    const planFactoryOwner = await publicClient
      .readContract({
        address: planFactoryAddress,
        abi: OWNABLE_OWNER_ABI,
        functionName: "owner",
      })
      .catch(() => null as `0x${string}` | null);

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
    return c.json({
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
    }, 409 as any);
  }

  const createPlanForCalldata = encodeFunctionData({
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
      registrationMode: "user_controlled",
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
      functionSignature:
        "createPlanFor(address,string,string,uint256,uint32,address,string,uint256,bytes)",
    },
  });
}
