import type { Context } from "hono";
import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { requirePermission, isErrorResponse } from "../../../lib/auth/api-auth.js";
import { getChain, getContractAddresses } from "@arcenpay/internal-core";
import { getRpcUrl } from "../../../config.js";
import { DEFAULT_CHAIN_ID } from "../../../lib/platform/default-chain.js";
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

function normalizePrivateKey(raw: string | undefined): `0x${string}` | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withPrefix = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  return /^0x[a-fA-F0-9]{64}$/.test(withPrefix)
    ? (withPrefix as `0x${string}`)
    : null;
}

export async function getPlanSignNonce(c: Context) {
  const auth = await requirePermission(c, "catalog:read");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const managedProviderKey = normalizePrivateKey(
    process.env.ONCHAIN_PROVIDER_PRIVATE_KEY ||
      process.env.SUBSCRIPTION_BILLER_PRIVATE_KEY,
  );
  const managedProviderAddress = managedProviderKey
    ? privateKeyToAccount(managedProviderKey).address
    : null;

  const userAddress = auth.team.walletAddress;
  const providerAddress = managedProviderAddress ?? userAddress ?? null;

  if (!providerAddress || !isAddress(providerAddress)) {
    return c.json({
        error:
          "No provider address is configured. Link a wallet or configure ONCHAIN_PROVIDER_PRIVATE_KEY / SUBSCRIPTION_BILLER_PRIVATE_KEY.",
      }, 400 as any);
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

    return c.json({
      nonce: nonce.toString(),
      chainId,
      planFactoryAddress,
      userAddress,
      providerAddress,
      signingRequired: !managedProviderAddress,
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
