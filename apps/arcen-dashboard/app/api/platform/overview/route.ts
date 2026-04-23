import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createPublicClient, http } from "viem";
import { FeeCollectorABI, TOKENS, getContractAddresses } from "@arcenpay/sdk";
import { db } from "@/lib/db";
import { isErrorResponse, requirePermission } from "@/lib/api-auth";
import { getGraphUrl, getRpcUrl } from "@/lib/config";
import {
  DEFAULT_CHAIN_ID,
  normalizeEnvironmentMode,
  resolveEnvironmentChainId,
} from "@/lib/default-chain";

const querySchema = z.object({
  chainId: z.coerce.number().int().positive().optional(),
  environmentMode: z.enum(["DEVELOPMENT", "PRODUCTION"]).optional(),
});

const PROTOCOL_STATS_QUERY = `
  query ProtocolStats {
    protocolStats(id: "global") {
      activeSubscriptions
      totalRevenue
    }
  }
`;

function decimalUsdcToMicroString(value: unknown): string | null {
  if (value == null) return null;
  const numeric = Number(String(value));
  if (!Number.isFinite(numeric)) return null;
  return String(Math.round(numeric * 1_000_000));
}

async function readProtocolStatsFromSubgraph(chainId: number): Promise<{
  activeSubscribers: number | null;
  totalRevenueRaw: string | null;
}> {
  const graphUrl = getGraphUrl(chainId);
  if (!graphUrl) {
    return { activeSubscribers: null, totalRevenueRaw: null };
  }

  try {
    const res = await fetch(graphUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: PROTOCOL_STATS_QUERY }),
      cache: "no-store",
    });

    if (!res.ok) {
      return { activeSubscribers: null, totalRevenueRaw: null };
    }

    const json = (await res.json()) as {
      data?: { protocolStats?: { activeSubscriptions?: string; totalRevenue?: string } };
    };

    const activeSubscriptionsRaw = json.data?.protocolStats?.activeSubscriptions;
    const totalRevenueRaw = json.data?.protocolStats?.totalRevenue;

    return {
      activeSubscribers:
        activeSubscriptionsRaw != null ? Number(activeSubscriptionsRaw) : null,
      totalRevenueRaw: totalRevenueRaw ?? null,
    };
  } catch {
    return { activeSubscribers: null, totalRevenueRaw: null };
  }
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

  const [planRows, invoiceTotals, invoiceRows, protocolStats, feesRaw] =
    await Promise.all([
      db.catalogPlan.findMany({
        where: {
          teamId: auth.team.teamId,
          environmentMode,
          active: true,
          status: { not: "ARCHIVED" },
        },
        select: { id: true },
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
      db.invoice.findMany({
        where: {
          teamId: auth.team.teamId,
          environmentMode,
          status: "PAID",
        },
        select: { customerWallet: true, customerEmail: true },
      }),
      readProtocolStatsFromSubgraph(chainId),
      readProtocolFees(chainId),
    ]);

  const activePlans = planRows.length;
  const activePlanIds = planRows.map((plan) => plan.id);
  const workspaceSubscriberCount = activePlanIds.length
    ? await db.arcenCompany.count({
        where: {
          teamId: auth.team.teamId,
          activePlanId: { in: activePlanIds },
        },
      })
    : 0;

  const uniqueSubscribers = new Set<string>();
  for (const row of invoiceRows) {
    if (row.customerWallet) uniqueSubscribers.add(`w:${row.customerWallet.toLowerCase()}`);
    else if (row.customerEmail) uniqueSubscribers.add(`e:${row.customerEmail.toLowerCase()}`);
  }

  return NextResponse.json({
    context: {
      teamId: auth.team.teamId,
      environmentMode,
      chainId,
    },
    metrics: {
      activePlans,
      activeSubscribers:
        protocolStats.activeSubscribers != null
          ? protocolStats.activeSubscribers
          : Math.max(uniqueSubscribers.size, workspaceSubscriberCount),
      monthlyRevenueRaw:
        decimalUsdcToMicroString(invoiceTotals._sum.total) ??
        protocolStats.totalRevenueRaw ??
        "0",
      protocolFeesRaw: feesRaw ?? "0",
    },
  });
}
