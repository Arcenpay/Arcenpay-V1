import { NextRequest, NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { SiweMessage } from "siwe";
import { createPublicClient, http } from "viem";
import { getContractAddresses, PlanFactoryABI } from "@meap/core";
import { sessionOptions, type SessionData } from "@/lib/session";

export async function POST(req: NextRequest) {
  const session = await getIronSession<SessionData>(
    await cookies(),
    sessionOptions,
  );

  const clearNonceAndFail = async (message: string, status = 400) => {
    session.nonce = "";
    session.isLoggedIn = false;
    session.address = "";
    session.chainId = 0;
    session.isProvider = false;
    await session.save();
    return NextResponse.json({ ok: false, error: message }, { status });
  };

  try {
    if (!session.nonce) {
      return clearNonceAndFail("Missing login nonce. Restart sign-in flow.");
    }

    const { message, signature } = await req.json();
    if (!message || !signature) {
      return clearNonceAndFail("Missing SIWE message or signature.");
    }

    const siweMessage = new SiweMessage(message);
    const expectedDomain = req.headers.get("host") ?? new URL(req.url).host;
    if (siweMessage.domain !== expectedDomain) {
      return clearNonceAndFail("SIWE domain mismatch.");
    }

    if (siweMessage.nonce !== session.nonce) {
      return clearNonceAndFail("Invalid or replayed SIWE nonce.");
    }

    const { data: fields } = await siweMessage.verify({
      signature,
      nonce: session.nonce,
      domain: expectedDomain,
    });

    const contracts = getContractAddresses(fields.chainId);
    const rpcUrlByChain: Record<number, string> = {
      11155111:
        process.env.SEPOLIA_RPC_URL ||
        "https://ethereum-sepolia-rpc.publicnode.com",
      84532: process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
      8453: process.env.BASE_MAINNET_RPC_URL || "https://mainnet.base.org",
    };

    const publicClient = createPublicClient({
      transport: http(rpcUrlByChain[fields.chainId]),
    });

    let isProvider = false;
    try {
      isProvider = (await publicClient.readContract({
        address: contracts.planFactory as `0x${string}`,
        abi: PlanFactoryABI,
        functionName: "isProvider",
        args: [fields.address as `0x${string}`],
      })) as boolean;
    } catch {
      // Do not block login on provider-check RPC faults.
      isProvider = false;
    }

    session.address = fields.address;
    session.chainId = fields.chainId;
    session.isProvider = isProvider;
    session.isLoggedIn = true;
    session.nonce = "";
    await session.save();

    return NextResponse.json({
      ok: true,
      address: fields.address,
      isProvider,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Verification failed";
    return clearNonceAndFail(message, 400);
  }
}
