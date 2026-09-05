/**
 * GET/PUT /api/v1/agent/permissions — Agent config CRUD
 */

import type { Context } from "hono";
import { Prisma } from "../../generated/client/client.js";
import { requirePermission, isErrorResponse } from "../../lib/auth/api-auth.js";
import { db } from "../../db.js";
import {
  getChainFamily,
  isValidAddressForChain,
} from "@arcenpay/internal-core";
import { resolveChainFamilyForPrisma } from "../../lib/platform/chain-family.js";

function readChainContext(
  body: Record<string, unknown>,
): { chainId?: number; chainFamily?: "EVM" | "STELLAR" } {
  const chainId =
    typeof body.chainId === "number" ? body.chainId : null;
  if (chainId === null || !Number.isInteger(chainId) || chainId <= 0) {
    return {};
  }
  const family = getChainFamily(chainId);
  if (!family) return {};
  return { chainId, chainFamily: resolveChainFamilyForPrisma(chainId) };
}

export async function GET(c: Context) {
  try {
    const ctx = await requirePermission(c, "catalog:read");
    if (isErrorResponse(ctx)) return c.json({ ok: false, error: ctx.error }, ctx.status as any);

    const { team } = ctx;
    const config = await db.arcenAgentConfig.findUnique({
      where: { teamId: team.teamId },
    });

    if (!config) {
      return c.json({
        data: {
          autoTopUp: { mode: "off", dailyLimit: "5.00", perTxnLimit: "1.00", threshold: "0.50" },
          dispatch: { enabled: false, providers: [], cooldownSeconds: 120, maxRetries: 3 },
          agentWalletAddress: "",
          chainId: null,
          chainFamily: "EVM",
        },
      });
    }

    return c.json({
      data: {
        autoTopUp: config.autoTopUp,
        dispatch: config.dispatch,
        agentWalletAddress: config.agentWalletAddress || "",
        chainId: config.chainId ?? null,
        chainFamily: config.chainFamily ?? "EVM",
      },
    });
  } catch (err: any) {
    console.error("[agent/permissions GET]", err);
    return c.json({ error: err.message || "Internal error" }, 500 as any);
  }
}

export async function PUT(c: Context) {
  try {
    const ctx = await requirePermission(c, "catalog:write");
    if (isErrorResponse(ctx)) return c.json({ ok: false, error: ctx.error }, ctx.status as any);

    const { team } = ctx;

    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400 as any);
    }

    const data: Record<string, unknown> = {};

    if (body.autoTopUp) {
      data.autoTopUp = body.autoTopUp;
    }
    if (body.dispatch) {
      data.dispatch = body.dispatch;
    }
    const chainContext = readChainContext(body);
    if (chainContext.chainId) {
      data.chainId = chainContext.chainId;
      data.chainFamily = chainContext.chainFamily;
    }
    if (typeof body.agentWalletAddress === "string" && body.agentWalletAddress) {
      const wallet = body.agentWalletAddress;
      const family =
        data.chainFamily ??
        resolveChainFamilyForPrisma(
          typeof data.chainId === "number" ? data.chainId : 84532,
        );
      const effectiveChainId =
        typeof data.chainId === "number" ? data.chainId : 84532;
      if (!isValidAddressForChain(wallet, effectiveChainId)) {
        return c.json({
          error: `Agent wallet is not a valid ${family} address for chain ${effectiveChainId}.`,
        }, 400 as any);
      }
      data.agentWalletAddress = wallet;
    }

    const existing = await db.arcenAgentConfig.findUnique({
      where: { teamId: team.teamId },
    });

    let config;
    if (existing) {
      config = await db.arcenAgentConfig.update({
        where: { teamId: team.teamId },
        data: data as any,
      });
    } else {
      config = await db.arcenAgentConfig.create({
        data: { teamId: team.teamId, ...data } as any,
      });
    }

    return c.json({
      data: {
        autoTopUp: config.autoTopUp,
        dispatch: config.dispatch,
        agentWalletAddress: config.agentWalletAddress || "",
        chainId: config.chainId ?? null,
        chainFamily: config.chainFamily ?? "EVM",
      },
    });
  } catch (err: any) {
    console.error("[agent/permissions PUT]", err);
    return c.json({ error: err?.message || err?.toString() || "Internal server error" }, 500 as any);
  }
}
