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
  getChainDescriptor,
  getTokenAddress,
  getContractAddresses,
  getStellarNetworkPassphrase,
  getSolanaRpcUrl,
  SessionVaultABI,
} from "@arcenpay/internal-core";
import { resolveChainFamilyForPrisma, type ChainFamilyPrisma } from "../../lib/platform/chain-family.js";
import { toPrismaJson } from "../../utils/prisma-json.js";
import { createPublicClient, http, getAddress, isAddress } from "viem";
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
    let clean = entry.address.trim();
    if (!isValidAddressForChain(clean, num)) continue;
    const fam = getChainFamily(num);
    if (fam === "evm" && isAddress(clean, { strict: false })) {
      try {
        clean = getAddress(clean.toLowerCase());
      } catch {}
    }
    out[key] = { address: clean, createdAt: new Date().toISOString() };
  }
  return out;
}

function readChainContext(
  body: Record<string, unknown>,
): { chainId?: number; chainFamily?: ChainFamilyPrisma } {
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
          let addr = (key && wallets[key]?.address) ? wallets[key].address : (config.agentWalletAddress || "");
          if (addr && config.chainFamily === "EVM" && isAddress(addr, { strict: false })) {
            try {
              addr = getAddress(addr.toLowerCase());
            } catch {}
          }
          return addr;
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

    if (body.resetWallets === true) {
      data.agentWalletAddress = "";
      data.agentWallets = toPrismaJson({});
    } else if (body.resetCurrentWallet === true) {
      const merged = { ...existingWallets };
      delete merged[String(effectiveChainId)];
      data.agentWallets = toPrismaJson(merged);
      const remaining = Object.values(merged)[0]?.address || "";
      data.agentWalletAddress = remaining;
    } else {
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

      if (typeof body.agentWalletAddress === "string") {
        if (!body.agentWalletAddress.trim()) {
          data.agentWalletAddress = "";
          const merged = { ...existingWallets };
          delete merged[String(effectiveChainId)];
          data.agentWallets = toPrismaJson(merged);
        } else {
          let wallet = body.agentWalletAddress.trim();
          if (!isValidAddressForChain(wallet, effectiveChainId)) {
            return c.json({
              error: `Agent wallet is not a valid ${family} address for chain ${effectiveChainId}.`,
            }, 400 as any);
          }
          if (family === "EVM" && isAddress(wallet, { strict: false })) {
            try {
              wallet = getAddress(wallet.toLowerCase());
            } catch {}
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
      }
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

export async function getAgentBalance(c: Context) {
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
          address: null,
          chainId: null,
          chainFamily: "evm",
          walletBalanceUsdc: "0.00",
          vaultBalanceUsdc: "0.00",
          totalUsdc: "0.00",
          preApprovals: [],
        },
      });
    }

    const queryChainId = c.req.query("chainId");
    const queryUserAddress = c.req.query("userAddress")?.trim() || "";
    const queryAgentAddress = c.req.query("agentAddress")?.trim() || "";
    const activeChainId = queryChainId ? Number(queryChainId) : (config.chainId ?? 84532);
    const wallets = readWalletsMap(asRecord(config.agentWallets));
    const rawWallet = queryAgentAddress || wallets[String(activeChainId)]?.address || config.agentWalletAddress || "";
    const agentWallet = rawWallet.trim();
    const preApprovals = Array.isArray(config.preApprovals) ? (config.preApprovals as any[]) : [];

    let userWalletBalanceUsdc = "0.00";
    let walletBalanceUsdc = "0.00";
    let vaultBalanceUsdc = "0.00";

    const fam = getChainFamily(activeChainId);
    if (fam === "evm") {
      try {
        const desc = getChainDescriptor(activeChainId);
        const rpcUrl = desc?.rpcUrl || (activeChainId === 5042002 ? "https://rpc.testnet.arc.network" : undefined);
        if (rpcUrl) {
          const client = createPublicClient({
            transport: http(rpcUrl, { timeout: 15_000 }),
          });
          const safeAgent = agentWallet && isAddress(agentWallet, { strict: false }) ? getAddress(agentWallet.toLowerCase()) : null;
          const safeUser = queryUserAddress && isAddress(queryUserAddress, { strict: false }) ? getAddress(queryUserAddress.toLowerCase()) : null;
          const usdcAddr = getTokenAddress(activeChainId, "USDC");
          const safeUsdc = usdcAddr && isAddress(usdcAddr, { strict: false }) ? getAddress(usdcAddr.toLowerCase()) : null;
          const contracts = getContractAddresses(activeChainId);
          const safeVault = contracts.sessionVault && isAddress(contracts.sessionVault, { strict: false }) ? getAddress(contracts.sessionVault.toLowerCase()) : null;

          const isNativeUsdc = desc?.nativeCurrencySymbol === "USDC";

          // 1. User wallet balance
          if (safeUser) {
            let uBal = 0n;
            if (safeUsdc) {
              uBal = await client.readContract({
                address: safeUsdc,
                abi: [{
                  type: "function",
                  name: "balanceOf",
                  inputs: [{ name: "account", type: "address" }],
                  outputs: [{ name: "", type: "uint256" }],
                  stateMutability: "view",
                }] as const,
                functionName: "balanceOf",
                args: [safeUser],
              }).catch(() => 0n);
            }
            if (uBal === 0n && isNativeUsdc) {
              const nativeBal = await client.getBalance({ address: safeUser }).catch(() => 0n);
              if (nativeBal > 0n) {
                userWalletBalanceUsdc = (Number(nativeBal) / 1e18).toFixed(2);
              }
            } else if (uBal > 0n) {
              userWalletBalanceUsdc = (Number(uBal) / 1e6).toFixed(2);
            }
          }

          // 2. Agent wallet balance
          if (safeAgent) {
            let bal = 0n;
            if (safeUsdc) {
              bal = await client.readContract({
                address: safeUsdc,
                abi: [{
                  type: "function",
                  name: "balanceOf",
                  inputs: [{ name: "account", type: "address" }],
                  outputs: [{ name: "", type: "uint256" }],
                  stateMutability: "view",
                }] as const,
                functionName: "balanceOf",
                args: [safeAgent],
              }).catch(() => 0n);
            }
            if (bal === 0n && isNativeUsdc) {
              const nativeBal = await client.getBalance({ address: safeAgent }).catch(() => 0n);
              if (nativeBal > 0n) {
                walletBalanceUsdc = (Number(nativeBal) / 1e18).toFixed(2);
              }
            } else if (bal > 0n) {
              walletBalanceUsdc = (Number(bal) / 1e6).toFixed(2);
            }
          }

          // 3. Vault balance (multi-source: safeAgent, safeUser, sessionIds)
          if (safeVault) {
            let maxVaultBal = 0n;
            if (safeAgent) {
              const vBalAgent = await client.readContract({
                address: safeVault,
                abi: SessionVaultABI,
                functionName: "getAgentBalance",
                args: [safeAgent],
              }).catch(() => 0n);
              if (vBalAgent > maxVaultBal) maxVaultBal = vBalAgent;
            }

            if (safeUser) {
              const vBalUser = await client.readContract({
                address: safeVault,
                abi: SessionVaultABI,
                functionName: "getAgentBalance",
                args: [safeUser],
              }).catch(() => 0n);
              if (vBalUser > maxVaultBal) maxVaultBal = vBalUser;
            }

            // Check specific session IDs from preApprovals
            let sessionSum = 0n;
            for (const pa of preApprovals) {
              const sId = typeof pa.sessionId === "string" ? pa.sessionId : null;
              if (sId && sId.startsWith("0x") && sId.length === 66) {
                const sBal = await client.readContract({
                  address: safeVault,
                  abi: SessionVaultABI,
                  functionName: "getBalance",
                  args: [sId as `0x${string}`],
                }).catch(() => 0n);
                if (sBal > 0n) {
                  sessionSum += sBal;
                }
              }
            }
            if (sessionSum > maxVaultBal) maxVaultBal = sessionSum;

            if (maxVaultBal > 0n) {
              vaultBalanceUsdc = (Number(maxVaultBal) / 1e6).toFixed(2);
            }
          }
        }
      } catch (e) {
        console.warn("[getAgentBalance EVM]", e);
      }
    } else if (fam === "stellar") {
      try {
        const { Horizon } = await import("@stellar/stellar-sdk");
        const passphrase = getStellarNetworkPassphrase(activeChainId);
        const horizonUrl = passphrase.includes("Test")
          ? "https://horizon-testnet.stellar.org"
          : "https://horizon.stellar.org";
        const server = new Horizon.Server(horizonUrl);

        if (queryUserAddress) {
          try {
            const userAcc = await server.loadAccount(queryUserAddress);
            const uLine = userAcc.balances.find((b: any) => b.asset_code === "USDC");
            if (uLine && "balance" in uLine) {
              userWalletBalanceUsdc = parseFloat(uLine.balance).toFixed(2);
            }
          } catch {}
        }

        if (agentWallet) {
          try {
            const account = await server.loadAccount(agentWallet);
            const usdcLine = account.balances.find((b: any) => b.asset_code === "USDC");
            if (usdcLine && "balance" in usdcLine) {
              walletBalanceUsdc = parseFloat(usdcLine.balance).toFixed(2);
            }
          } catch {}
        }
      } catch (e) {
        console.warn("[getAgentBalance Stellar]", e);
      }
    } else if (fam === "solana") {
      try {
        const { Connection, PublicKey } = await import("@solana/web3.js");
        const rpcUrl = getSolanaRpcUrl(activeChainId);
        const usdcMint = getTokenAddress(activeChainId, "USDC");
        if (rpcUrl && usdcMint) {
          const connection = new Connection(rpcUrl, "confirmed");
          const readBalance = async (owner: string): Promise<string> => {
            if (!owner) return "0.00";
            try {
              const accounts = await connection.getParsedTokenAccountsByOwner(
                new PublicKey(owner),
                { mint: new PublicKey(usdcMint) },
              );
              const total = accounts.value.reduce((sum, { account }) => {
                const amount = (account.data as any)?.parsed?.info?.tokenAmount?.uiAmount;
                return sum + (typeof amount === "number" ? amount : 0);
              }, 0);
              return total.toFixed(2);
            } catch {
              return "0.00";
            }
          };
          if (queryUserAddress) {
            userWalletBalanceUsdc = await readBalance(queryUserAddress);
          }
          if (agentWallet) {
            walletBalanceUsdc = await readBalance(agentWallet);
          }
        }
      } catch (e) {
        console.warn("[getAgentBalance Solana]", e);
      }
    }

    // Recorded preApprovals reconciliation fallback. This models the EVM
    // SessionVault / approve-and-fund flow only — Stellar and Solana have no
    // vault, and applying it there fabricates a balance from stale EVM-style
    // pre-approval rows (e.g. a phantom vault balance) whenever the real
    // on-chain balance is zero.
    if (fam === "evm") {
      if (parseFloat(vaultBalanceUsdc) <= 0) {
        const preVault = preApprovals
          .filter((p: any) => p.mode === "approve_and_fund" && Number(p.amount) > 0)
          .reduce((sum: number, p: any) => sum + Number(p.amount), 0);
        if (preVault > 0) {
          vaultBalanceUsdc = preVault.toFixed(2);
        }
      }

      if (parseFloat(walletBalanceUsdc) <= 0) {
        const preTransfer = preApprovals
          .filter((p: any) => p.mode === "transfer" && Number(p.amount) > 0)
          .reduce((sum: number, p: any) => sum + Number(p.amount), 0);
        if (preTransfer > 0) {
          walletBalanceUsdc = preTransfer.toFixed(2);
        }
      }
    }

    const totalUsdc = (parseFloat(walletBalanceUsdc) + parseFloat(vaultBalanceUsdc)).toFixed(2);

    return c.json({
      data: {
        address: agentWallet,
        userAddress: queryUserAddress || null,
        chainId: activeChainId,
        chainFamily: getChainFamily(activeChainId) || "evm",
        userWalletBalanceUsdc,
        walletBalanceUsdc,
        vaultBalanceUsdc,
        totalUsdc,
        preApprovals,
      },
    });
  } catch (err: any) {
    console.error("[getAgentBalance]", err);
    return c.json({ error: err.message || "Internal error" }, 500 as any);
  }
}
