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
import { toPrismaJson } from "../../utils/prisma-json.js";
import { asRecord, readString } from "../../lib/billing/utils.js";

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
          preApprovals: [],
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
        preApprovals: asRecord(config.preApprovals),
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
        preApprovals: asRecord(config.preApprovals),
      },
    });
  } catch (err: any) {
    console.error("[agent/permissions PUT]", err);
    return c.json({ error: err?.message || err?.toString() || "Internal server error" }, 500 as any);
  }
}

/**
 * POST /api/v1/agent/fund — record an agent pre-funding/pre-approval.
 *
 * Called by the dashboard after the user successfully approves + funds the
 * session vault (EVM) or transfers USDC to the agent wallet (Stellar).
 * The on-chain txHash makes the record idempotent against double-submits.
 */
export async function recordAgentFunding(c: Context) {
  const ctx = await requirePermission(c, "catalog:write");
  if (isErrorResponse(ctx)) return c.json({ ok: false, error: ctx.error }, ctx.status as any);

  const { team } = ctx;

  let body: {
    amount?: unknown;
    txHash?: unknown;
    chainId?: unknown;
    mode?: unknown;
    sessionId?: unknown;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400 as any);
  }

  const amount = typeof body.amount === "string" && Number.parseFloat(body.amount) > 0
    ? Number.parseFloat(body.amount).toFixed(6)
    : null;
  const txHash = readString(body.txHash);
  const chainId =
    typeof body.chainId === "number" && Number.isInteger(body.chainId) && body.chainId > 0
      ? body.chainId
      : null;
  const mode =
    body.mode === "approve_and_fund" || body.mode === "transfer"
      ? body.mode
      : "approve_and_fund";

  if (!amount || !txHash || !chainId) {
    return c.json(
      { error: "amount, txHash and chainId are required" },
      400 as any,
    );
  }

  const existing = await db.arcenAgentConfig.findUnique({
    where: { teamId: team.teamId },
  });
  const prior = Array.isArray(existing?.preApprovals)
    ? (existing?.preApprovals as Array<Record<string, unknown>>)
    : [];
  // Dedup by txHash so re-submits never append duplicates.
  if (prior.some((entry) => readString(entry.txHash) === txHash)) {
    return c.json({ ok: true, deDuplicated: true, data: { preApprovals: prior } });
  }
  const next = [
    ...prior,
    {
      amount,
      txHash,
      chainId,
      mode,
      sessionId: body.sessionId == null ? null : String(body.sessionId),
      createdAt: new Date().toISOString(),
    },
  ].slice(-50);

  const data: Record<string, unknown> = {
    preApprovals: toPrismaJson(next),
  };
  if (existing && !existing.chainId && chainId) {
    data.chainId = chainId;
    data.chainFamily = resolveChainFamilyForPrisma(chainId);
  }

  if (existing) {
    await db.arcenAgentConfig.update({
      where: { teamId: team.teamId },
      data: data as any,
    });
  } else {
    await db.arcenAgentConfig.create({
      data: { teamId: team.teamId, ...data } as any,
    });
  }

  return c.json({ ok: true, data: { preApprovals: next } }, 201 as any);
}
