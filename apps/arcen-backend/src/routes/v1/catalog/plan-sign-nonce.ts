import type { Context } from "hono";
import { db } from "../../../db.js";
import { requirePermission, isErrorResponse } from "../../../lib/auth/api-auth.js";
import { requireResolvedActiveEnvironment } from "../../../lib/environments/workspace-environments.js";
import {
  getContractAddresses,
  PlanFactoryABI,
  isEvmChain,
  isValidAddressForChain,
  getStellarNetworkPassphrase,
  getStellarSorobanRpcUrl,
} from "@arcenpay/internal-core";
import { contract as stellarContract } from "@stellar/stellar-sdk";
import { createResilientPublicClient } from "../../../config.js";
import { resolvePlanNetwork } from "../../../lib/catalog/plan-network.js";

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
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any);

  const planId = c.req.param("id");

  const plan = await db.catalogPlan.findFirst({
    where: { id: planId, teamId: auth.team.teamId },
  });

  if (!plan) {
    return c.json({ error: "Plan not found" }, 404 as any);
  }

  const activeEnv = await requireResolvedActiveEnvironment(
    auth.session,
    auth.team.teamId,
  );

  const resolvedNetwork = resolvePlanNetwork({
    environmentMode: activeEnv?.mode ?? "DEVELOPMENT",
    acceptedToken: plan.acceptedToken,
    requestedChainId: activeEnv?.chainId,
  });

  if (!resolvedNetwork) {
    return c.json({ error: "Chain or accepted token not supported for this plan" }, 400 as any);
  }

  const chainId = resolvedNetwork.chainId;
  const providerAddress = isEvmChain(chainId)
    ? auth.team.walletAddress
    : auth.team.stellarWalletAddress;

  if (!providerAddress || !isValidAddressForChain(providerAddress, chainId)) {
    return c.json(
      { error: "No valid provider wallet linked to this account." },
      400 as any,
    );
  }

  const userAddress = c.req.query("userAddress");
  if (userAddress && isValidAddressForChain(userAddress, chainId) && userAddress.toLowerCase() !== providerAddress.toLowerCase()) {
    return c.json(
      {
        error: `Connected wallet (${userAddress}) does not match team provider wallet (${providerAddress}). Switch your wallet to sign.`,
      },
      403 as any,
    );
  }

  const contracts = getContractAddresses(chainId);
  const planFactoryAddress = contracts.planFactory;

  if (
    !planFactoryAddress ||
    planFactoryAddress === "0x0000000000000000000000000000000000000000"
  ) {
    return c.json({ error: "PlanFactory not deployed on this chain" }, 503 as any);
  }

  if (!isEvmChain(chainId)) {
    // Stellar: pre-flight check via is_approved_token view function
    const networkPassphrase = getStellarNetworkPassphrase(chainId);
    const sorobanRpcUrl = getStellarSorobanRpcUrl(chainId);
    try {
      const client = (await stellarContract.Client.from({
        contractId: planFactoryAddress,
        networkPassphrase,
        rpcUrl: sorobanRpcUrl,
        publicKey: providerAddress,
      })) as any;

      const { result: isApproved } = await client.is_approved_token({
        token: plan.acceptedToken,
      });

      if (!isApproved) {
        return c.json(
          {
            error:
              `The accepted token (${plan.acceptedToken}) is not approved in the PlanFactory contract. ` +
              `Call approve_token on the PlanFactory (admin required) to whitelist this token before registering plans.`,
            needsTokenApproval: true,
            planFactoryAddress,
            tokenAddress: plan.acceptedToken,
          },
          400 as any,
        );
      }
    } catch {
      // Non-blocking: if the read fails, let the real transaction surface the error
    }

    // Stellar: no EIP-712 nonce; return contract metadata so the frontend
    // can build a Soroban transaction directly.
    let signatureMode: "create" | "update" = plan.onChainPlanId ? "update" : "create";

    return c.json({
      chainId,
      planFactoryAddress,
      providerAddress,
      userAddress: providerAddress,
      signingRequired: true,
      signatureMode,
      networkPassphrase,
      sorobanRpcUrl,
    });
  }

  const publicClient = createResilientPublicClient(chainId);

  try {
    const nonce = await publicClient.readContract({
      address: planFactoryAddress as `0x${string}`,
      abi: NONCES_ABI,
      functionName: "nonces",
      args: [providerAddress as `0x${string}`],
    });

    let signatureMode: "create" | "update" = plan.onChainPlanId
      ? "update"
      : "create";

    if (plan.onChainPlanId) {
      const onChainPlan = (await publicClient.readContract({
        address: planFactoryAddress as `0x${string}`,
        abi: PlanFactoryABI,
        functionName: "getPlan",
        args: [BigInt(plan.onChainPlanId)],
      })) as {
        provider: `0x${string}`;
        name: string;
        tier: string;
        billingInterval: number;
        acceptedToken: string;
      };

      const isTokenMismatch =
        onChainPlan.acceptedToken.toLowerCase() !== plan.acceptedToken.toLowerCase();

      const immutableMismatch =
        onChainPlan.name !== plan.name ||
        onChainPlan.tier !== plan.tier ||
        Number(onChainPlan.billingInterval) !== plan.billingInterval ||
        isTokenMismatch;

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
      userAddress: providerAddress,
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
    const isRateLimited =
      message.includes("request limit reached") ||
      message.includes("429") ||
      message.includes("rate limit");
    const status = isRateLimited ? 429 : 500;
    const cleanMessage = isRateLimited
      ? "RPC node rate limit reached. Please wait a few seconds and try again."
      : message;
    return c.json({ error: cleanMessage }, status as any);
  }
}
