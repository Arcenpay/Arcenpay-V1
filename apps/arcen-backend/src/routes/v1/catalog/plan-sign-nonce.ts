import type { Context } from "hono";
import { createPublicClient, http } from "viem";
import { db } from "../../../db.js";
import { requirePermission, isErrorResponse } from "../../../lib/auth/api-auth.js";
import { getChain, getContractAddresses, PlanFactoryABI } from "@arcenpay/internal-core";
import { getRpcUrl } from "../../../config.js";
import { resolvePlanNetwork } from "../../../lib/catalog/plan-network.js";
import { isAddress } from "viem";

const NONCES_ABI = [
  {
    inputs: [{ name: "provider", type: "address" }],
    name: "nonces",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

export async function getPlanSignNonce(c: Context) {
  const auth = await requirePermission(c, "catalog:read");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);
  const planId = c.req.param("id");

  const userAddress = auth.team.walletAddress;
  const providerAddress = userAddress ?? null;

  if (!providerAddress || !isAddress(providerAddress)) {
    return c.json({
        error:
          "No provider wallet is linked to this team. Link your wallet first to register plans on-chain.",
      }, 400 as any);
  }

  const plan = await db.catalogPlan.findFirst({
    where: { id: planId, teamId: auth.team.teamId },
    select: {
      id: true,
      environmentMode: true,
      environment: {
        select: {
          mode: true,
          chainId: true,
        },
      },
      name: true,
      tier: true,
      billingInterval: true,
      acceptedToken: true,
      chainId: true,
      onChainPlanId: true,
    },
  });
  if (!plan) {
    return c.json({ error: "Plan not found" }, 404 as any);
  }

  const resolvedNetwork = resolvePlanNetwork({
    environmentMode: plan.environment?.mode ?? plan.environmentMode,
    acceptedToken: plan.acceptedToken,
    requestedChainId: plan.environment?.chainId ?? plan.chainId,
  });
  if (!resolvedNetwork) {
    return c.json({
      error:
        "Plan has an invalid billing network configuration. Update the plan and try again.",
    }, 400 as any);
  }

  if (
    !plan.onChainPlanId &&
    (plan.chainId !== resolvedNetwork.chainId ||
      plan.acceptedToken.toLowerCase() !== resolvedNetwork.acceptedToken.toLowerCase())
  ) {
    await db.catalogPlan.update({
      where: { id: plan.id },
      data: {
        chainId: resolvedNetwork.chainId,
        acceptedToken: resolvedNetwork.acceptedToken,
        chainSyncStatus: "PENDING",
        chainSyncError: null,
        chainSyncedAt: null,
      },
    });
  }

  const chainId = resolvedNetwork.chainId;
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

  try {
    const nonce = await publicClient.readContract({
      address: planFactoryAddress,
      abi: NONCES_ABI,
      functionName: "nonces",
      args: [providerAddress as `0x${string}`],
    });

    let signatureMode: "create" | "update" = plan.onChainPlanId
      ? "update"
      : "create";

    if (plan.onChainPlanId) {
      const onChainPlan = (await publicClient.readContract({
        address: planFactoryAddress,
        abi: PlanFactoryABI,
        functionName: "getPlan",
        args: [BigInt(plan.onChainPlanId)],
      })) as {
        provider: `0x${string}`;
        name: string;
        tier: string;
        billingInterval: number;
        acceptedToken: `0x${string}`;
      };

      const immutableMismatch =
        onChainPlan.name !== plan.name ||
        onChainPlan.tier !== plan.tier ||
        Number(onChainPlan.billingInterval) !== plan.billingInterval ||
        onChainPlan.acceptedToken.toLowerCase() !==
          plan.acceptedToken.toLowerCase();

      if (immutableMismatch) {
        const activeSubscriberCount = await db.subscriptionState.count({
          where: {
            teamId: auth.team.teamId,
            catalogPlanId: plan.id,
            status: { in: ["ACTIVE", "PAST_DUE"] },
          },
        });

        if (activeSubscriberCount === 0) {
          signatureMode = "create";
        }
      }
    }

    return c.json({
      nonce: nonce.toString(),
      chainId,
      planFactoryAddress,
      userAddress,
      providerAddress,
      signingRequired: true,
      signatureMode,
      domain: {
        name: "ArcenPay PlanFactory",
        version: "1",
        chainId,
        verifyingContract: planFactoryAddress,
      },
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to fetch nonce";
    return c.json({ error: message }, 500 as any);
  }
}
