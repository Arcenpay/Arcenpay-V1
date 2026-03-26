import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { requirePermission, isErrorResponse } from "@/lib/api-auth";
import { getContractAddresses } from "@arcenpay/sdk";
import { getRpcUrl } from "@/lib/config";
import { sepolia, baseSepolia, base } from "viem/chains";
import type { Chain } from "viem";

const CHAIN_MAP: Record<number, Chain> = {
  11155111: sepolia,
  84532: baseSepolia,
  8453: base,
};

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

export async function GET(
  request: NextRequest,
  context: { params: Promise<Params> },
) {
  const auth = await requirePermission("catalog:read");
  if (isErrorResponse(auth)) return auth;

  const userAddress = auth.team.walletAddress;
  if (!userAddress) {
    return NextResponse.json(
      {
        error:
          "No wallet linked to this account. Please link your wallet first.",
      },
      { status: 400 },
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

  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });

  try {
    const nonce = await publicClient.readContract({
      address: planFactoryAddress,
      abi: NONCES_ABI,
      functionName: "nonces",
      args: [userAddress as `0x${string}`],
    });

    return NextResponse.json({
      nonce: nonce.toString(),
      chainId,
      planFactoryAddress,
      userAddress,
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
