import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createPublicClient, http } from "viem";
import { FeeCollectorABI, TOKENS, getContractAddresses } from "@arcenpay/internal-core";
import { db } from "@/lib/db";
import { isErrorResponse, requirePermission } from "@/lib/api-auth";
import { getRpcUrl } from "@/lib/config";
import {
  DEFAULT_CHAIN_ID,
  normalizeEnvironmentMode,
  resolveEnvironmentChainId,
} from "@/lib/default-chain";

const querySchema = z.object({
  chainId: z.coerce.number().int().positive().optional(),
  environmentMode: z.enum(["DEVELOPMENT", "PRODUCTION"]).optional(),
});

function decimalUsdcToMicroString(value: unknown): string | null {
  if (value == null) return null;
  const numeric = Number(String(value));
  if (!Number.isFinite(numeric)) return null;
  return String(Math.round(numeric * 1_000_000));
}

async function readProtocolFees(chainId: number): Promise<string | null> {
  try {
    const contracts = getContractAddresses(chainId);
    if (
      !contracts.feeCollector ||
      contracts.feeCollector.toLowerCase() ===
        "0x0000000000000000000000000000000000000000"
    ) {
      return null;
    }

    const usdc =
      TOKENS[chainId as keyof typeof TOKENS]?.USDC ||
      TOKENS[DEFAULT_CHAIN_ID as keyof typeof TOKENS]?.USDC;
    if (!usdc) return null;

    const rpcUrl = getRpcUrl(chainId);
    if (!rpcUrl) return null;

    const client = createPublicClient({
      transport: http(rpcUrl, { timeout: 8_000 }),
    });

    const fees = (await client.readContract({
      address: contracts.feeCollector as `0x${string}`,
      abi: FeeCollectorABI,
      functionName: "accumulatedFees",
      args: [usdc as `0x${string}`],
    })) as bigint;

    return fees.toString();
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const auth = await requirePermission("catalog:read");
  if (isErrorResponse(auth)) return auth;

  const parsed = querySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const team = await db.team.findUnique({
    where: { id: auth.team.teamId },
    select: { environmentMode: true },
  });
  if (!team) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  const environmentMode = normalizeEnvironmentMode(
    parsed.data.environmentMode || team.environmentMode,
  );
  const chainId = resolveEnvironmentChainId(
    environmentMode,
    parsed.data.chainId,
  );

  const [
    activePlans,
    activeSubscribers,
    invoiceTotals,
    feesRaw,
  ] =
    await Promise.all([
      db.catalogPlan.count({
        where: {
          teamId: auth.team.teamId,
          environmentMode,
          active: true,
          status: { not: "ARCHIVED" },
        },
      }),
      db.subscriptionState.count({
        where: {
          teamId: auth.team.teamId,
          status: { in: ["ACTIVE", "PAST_DUE"] },
        },
      }),
      db.invoice.aggregate({
        where: {
          teamId: auth.team.teamId,
          environmentMode,
          status: "PAID",
          issuedAt: {
            gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          },
        },
        _sum: { total: true },
      }),
      readProtocolFees(chainId),
    ]);
  const dependencyHealth = {
    protocolFees: feesRaw ? "ok" : "unavailable",
  } as const;
  const degraded = dependencyHealth.protocolFees !== "ok";

  return NextResponse.json({
    context: {
      teamId: auth.team.teamId,
      environmentMode,
      chainId,
    },
    degraded,
    dependencyHealth,
    metrics: {
      activePlans,
      activeSubscribers,
      paidInvoiceRevenue30dRaw:
        decimalUsdcToMicroString(invoiceTotals._sum.total),
      protocolFeesRaw: feesRaw,
    },
  });
}
