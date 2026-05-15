import type { Context } from "hono";
import { z } from "zod";
import { createPublicClient, http } from "viem";
import { FeeCollectorABI, getTokenAddress, getContractAddresses } from "@arcenpay/internal-core";
import { db } from "../../../db.js";
import { isErrorResponse, requirePermission } from "../../../lib/auth/api-auth.js";
import { getRpcUrl } from "../../../config.js";
import { DEFAULT_CHAIN_ID } from "../../../lib/platform/default-chain.js";
import { requireResolvedActiveEnvironment } from "../../../lib/environments/workspace-environments.js";

const querySchema = z.object({
  chainId: z.coerce.number().int().positive().optional(),
  environmentMode: z.enum(["DEVELOPMENT", "PRODUCTION"]).optional(),
});

function decimalUsdcToMicroString(
  value: unknown,
  fallbackMicroValue: string | null = null,
): string | null {
  if (value == null) return fallbackMicroValue;
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
      getTokenAddress(chainId, "USDC") ||
      getTokenAddress(DEFAULT_CHAIN_ID, "USDC");
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

export async function getOverview(c: Context) {
  const auth = await requirePermission(c, "catalog:read");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const parsed = querySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: "Invalid query", details: parsed.error.flatten().fieldErrors }, 400 as any);
  }

  const activeEnvironment = await requireResolvedActiveEnvironment(
    auth.session,
    auth.team.teamId,
  );
  if (!activeEnvironment) {
    return c.json({ error: "No workspace environment selected" }, 409 as any);
  }
  const environmentMode = activeEnvironment.mode;
  const chainId = activeEnvironment.chainId;
  const activeEnvironmentPlanIds = (
    await db.catalogPlan.findMany({
      where: {
        teamId: auth.team.teamId,
        environmentId: activeEnvironment.id,
      },
      select: { id: true },
    })
  ).map((plan) => plan.id);

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
          environmentId: activeEnvironment.id,
          active: true,
          status: { not: "ARCHIVED" },
        },
      }),
      db.subscriptionState.count({
        where: {
          teamId: auth.team.teamId,
          status: { in: ["ACTIVE", "PAST_DUE"] },
          OR: [
            { environmentId: activeEnvironment.id },
            {
              environmentId: null,
              company: {
                is: {
                  environmentId: activeEnvironment.id,
                },
              },
            },
          ],
        },
      }),
      db.invoice.aggregate({
        where: {
          teamId: auth.team.teamId,
          status: "PAID",
          issuedAt: {
            gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          },
          OR: [
            { environmentId: activeEnvironment.id },
            ...(activeEnvironmentPlanIds.length > 0
              ? [
                  {
                    environmentId: null,
                    planId: { in: activeEnvironmentPlanIds },
                  },
                ]
              : []),
          ],
        },
        _sum: { total: true },
      }),
      readProtocolFees(chainId),
    ]);
  const dependencyHealth = {
    protocolFees: feesRaw ? "ok" : "unavailable",
  } as const;
  const degraded = dependencyHealth.protocolFees !== "ok";

  return c.json({
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
        decimalUsdcToMicroString(invoiceTotals._sum.total, "0"),
      protocolFeesRaw: feesRaw,
    },
  });
}
