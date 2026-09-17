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

function readWalletsMap(value: unknown): Record<string, { address: string; createdAt: string }> {
  // Accepts { [chainId]: address } (string) or { [chainId]: { address } }
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, { address: string; createdAt: string }> = {};
  for (const [chainId, raw] of Object.entries(value as Record<string, unknown>)) {
    const key = chainId.replace(/\D/g, "");
    if (!key) continue;
    const num = Number(key);
    const entry =
      typeof raw === "string"
        ? { address: raw }
        : typeof raw === "object" && raw !== null && typeof (raw as any).address === "string"
          ? { address: (raw as any).address }
          : null;
    if (!entry || !entry.address.trim()) continue;
    if (!isValidAddressForChain(entry.address.trim(), num)) continue;
    out[key] = { address: entry.address.trim(), createdAt: new Date().toISOString() };
  }
  return out;
}

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
          agentWallets: {},
        },
      });
    }

    return c.json({
      data: {
        autoTopUp: config.autoTopUp,
        dispatch: config.dispatch,
        chainId: config.chainId ?? null,
        chainFamily: config.chainFamily ?? "EVM",
        preApprovals: asRecord(config.preApprovals),
        agentWallets: readWalletsMap(asRecord(config.agentWallets)),
        agentWalletAddress: (() => {
          // Prefer the wallet for the persisted chainId; fall back to the
          // legacy single-wallet field for backward compatibility.
          const wallets = readWalletsMap(asRecord(config.agentWallets));
          const key = config.chainId ? String(config.chainId) : null;
          if (key && wallets[key]?.address) return wallets[key].address;
          return config.agentWalletAddress || "";
        })(),
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
    // Read the existing row so per-chain wallets merge instead of clobbering.
    const existing = await db.arcenAgentConfig.findUnique({
      where: { teamId: team.teamId },
    });
    const existingWallets = readWalletsMap(
      existing ? asRecord(existing.agentWallets) : {},
    );

    const effectiveChainId =
      typeof data.chainId === "number" ? data.chainId
      : existing?.chainId ?? 84532;
    const family = resolveChainFamilyForPrisma(effectiveChainId);

    if (body.agentWallets && typeof body.agentWallets === "object") {
      // Merge the per-chain map the client sent into the existing map.
      const incoming = readWalletsMap(body.agentWallets);
      const merged = { ...existingWallets };
      for (const [chain, entry] of Object.entries(incoming)) {
        if (entry.address && isValidAddressForChain(entry.address, Number(chain))) {
          merged[chain] = entry;
        }
      }
      data.agentWallets = toPrismaJson(merged);
      // Keep the legacy single-wallet alias pointed at the active chain.
      const active = merged[String(effectiveChainId)];
      if (active?.address) {
        data.agentWalletAddress = active.address;
      }
    }

    if (typeof body.agentWalletAddress === "string" && body.agentWalletAddress) {
      const wallet = body.agentWalletAddress;
      if (!isValidAddressForChain(wallet, effectiveChainId)) {
        return c.json({
          error: `Agent wallet is not a valid ${family} address for chain ${effectiveChainId}.`,
        }, 400 as any);
      }
      data.agentWalletAddress = wallet;
      // Sync the new wallet into the per-chain map too.
      data.agentWallets = toPrismaJson({
        ...existingWallets,
        [String(effectiveChainId)]: {
          address: wallet,
          createdAt: new Date().toISOString(),
        },
      });
    }

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
        agentWallets: readWalletsMap(asRecord(config.agentWallets)),
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
