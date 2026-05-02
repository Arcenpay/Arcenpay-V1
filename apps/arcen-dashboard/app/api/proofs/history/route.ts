import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth.server";
import { FACILITATOR_URL, FACILITATOR_SECRET } from "@/lib/config";
import {
  RUNTIME_CHAIN_ID,
  RUNTIME_CHAIN_PROFILE,
  getRuntimeChainWarning,
} from "@/lib/runtime-chain";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const rawLimit = Number(searchParams.get("limit") || "12");
    const limit = Number.isFinite(rawLimit)
      ? Math.max(1, Math.min(Math.trunc(rawLimit), 200))
      : 12;
    const requestedChainIdRaw = searchParams.get("chainId");
    const requestedChainId = requestedChainIdRaw
      ? Number.parseInt(requestedChainIdRaw, 10)
      : null;

    if (requestedChainId && Number.isFinite(requestedChainId)) {
      const healthRes = await fetch(`${FACILITATOR_URL}/health`, {
        method: "GET",
        headers: {
          Accept: "application/json",
          ...(FACILITATOR_SECRET
            ? { Authorization: `Bearer ${FACILITATOR_SECRET}` }
            : {}),
        },
        cache: "no-store",
      });
      if (healthRes.ok) {
        const health = (await healthRes.json()) as { chainId?: number };
        if (
          typeof health.chainId === "number" &&
          health.chainId !== requestedChainId
        ) {
          return NextResponse.json({
            count: 0,
            jobs: [],
            degraded: true,
            message: getRuntimeChainWarning({
              actualChainId: health.chainId,
              expectedChainId: requestedChainId,
            }),
            chainMismatch: {
              requestedChainId,
              facilitatorChainId: health.chainId,
            },
            runtimeChain: {
              expectedChainId: RUNTIME_CHAIN_ID,
              expectedChainName: RUNTIME_CHAIN_PROFILE.chainName,
              rpcEnvKeys: RUNTIME_CHAIN_PROFILE.rpcEnvKeys,
              subgraphEnvKeys: RUNTIME_CHAIN_PROFILE.subgraphEnvKeys,
            },
          });
        }
      }
    }

    const upstream = await fetch(
      `${FACILITATOR_URL}/api/proofs/history?limit=${limit}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          ...(FACILITATOR_SECRET
            ? { Authorization: `Bearer ${FACILITATOR_SECRET}` }
            : {}),
        },
        cache: "no-store",
      },
    );

    if (!upstream.ok) {
      return NextResponse.json({
        count: 0,
        jobs: [],
        degraded: true,
        message: `Facilitator returned ${upstream.status}.`,
      });
    }

    const payload = await upstream.json();
    const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
    return NextResponse.json({
      count: Number(payload.count) || jobs.length,
      jobs,
      degraded: false,
    });
  } catch (err) {
    console.error("[api/proofs/history]", err);
    return NextResponse.json({
      count: 0,
      jobs: [],
      degraded: true,
      message: err instanceof Error ? err.message : "Proof history unavailable.",
    });
  }
}
