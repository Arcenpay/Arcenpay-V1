import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { requirePermission, isErrorResponse } from "@/lib/api-auth";
import { getChain, getContractAddresses } from "@arcenpay/sdk";
import { getRpcUrl } from "@/lib/config";
import { DEFAULT_CHAIN_ID } from "@/lib/default-chain";
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

type Params = { id: string };

function normalizePrivateKey(raw: string | undefined): `0x${string}` | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withPrefix = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  return /^0x[a-fA-F0-9]{64}$/.test(withPrefix)
    ? (withPrefix as `0x${string}`)
    : null;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<Params> },
) {
  const auth = await requirePermission("catalog:read");
  if (isErrorResponse(auth)) return auth;

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
    return NextResponse.json(
      {
        error:
          "No provider address is configured. Link a wallet or configure ONCHAIN_PROVIDER_PRIVATE_KEY / SUBSCRIPTION_BILLER_PRIVATE_KEY.",
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

  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });

  try {
    const nonce = await publicClient.readContract({
      address: planFactoryAddress,
      abi: NONCES_ABI,
      functionName: "nonces",
      args: [providerAddress as `0x${string}`],
    });

    return NextResponse.json({
      nonce: nonce.toString(),
      chainId,
      planFactoryAddress,
      userAddress,
      providerAddress,
      signingRequired: !managedProviderAddress,
      // EIP-712 domain info for frontend signing
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
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
