// ============================================================
//  Dashboard — Gas Sponsorship Policy Engine
//
//  Determines whether to sponsor gas for a given transaction,
//  tracks daily gas spending per team, and enforces budgets.
//
//  Rules:
//  - Always sponsor subscriber-side transactions (checkout, renewal)
//  - L2 chains only (Base, Base Sepolia) — reject L1 sponsorship
//  - Enforce daily gas budget per team tier
//  - Anti-abuse: max sponsorship per wallet per day
//  - Budget alert thresholds at 80% and 100%
// ============================================================

import { db } from "@/lib/db";
import { getTierLimits } from "@/lib/tier-guard";
import { PlatformTier, Prisma } from "@/src/generated/prisma/client";

// ── Allowed chains for gas sponsorship (L2 only) ─────────────────────────────

const SPONSORED_CHAIN_IDS = new Set<number>([
    8453,   // Base mainnet
    84532,  // Base Sepolia
]);

// L1 chains where sponsorship is explicitly blocked
const BLOCKED_CHAIN_IDS = new Set<number>([
    1,          // Ethereum mainnet
    11155111,   // Sepolia (L1 testnet)
]);

// ── Anti-abuse limits ────────────────────────────────────────────────────────

const MAX_SPONSORED_TXS_PER_WALLET_PER_DAY = 50;

// ── Budget alert threshold ───────────────────────────────────────────────────

const BUDGET_ALERT_THRESHOLD = 0.8; // 80%

// ── Sponsored transaction types ──────────────────────────────────────────────

export type SponsoredTxType =
    | "subscribe"    // new subscription mint
    | "renew"        // subscription renewal
    | "cancel"       // subscription cancellation
    | "deposit"      // session vault deposit
    | "withdraw"     // session vault withdrawal
    | "other";

// Only these tx types are eligible for sponsorship
const SPONSORABLE_TX_TYPES = new Set<SponsoredTxType>([
    "subscribe",
    "renew",
    "deposit",
]);

// ── Types ────────────────────────────────────────────────────────────────────

export type SponsorDecision =
    | { sponsor: true; reason: string }
    | { sponsor: false; reason: string };

export type GasBudgetInfo = {
    tier: PlatformTier;
    dailyBudgetUsd: number;
    spentTodayUsd: number;
    remainingUsd: number;
    isGasSponsored: boolean;
    budgetAlertTriggered: boolean;
    txCountToday: number;
};

// ── Paymaster integration types ──────────────────────────────────────────────
// These types define the interface for the paymaster service (ERC-4337 or relay)

export type PaymasterRequest = {
    teamId: string;
    chainId: number;
    walletAddress: string;
    txType: SponsoredTxType;
    to: string;
    data: string;
    value?: string;
};

export type PaymasterResponse =
    | {
        sponsored: true;
        paymasterAndData: string; // ERC-4337 paymaster data
        maxGasCostUsd: number;
    }
    | {
        sponsored: false;
        reason: string;
    };

// ── Policy evaluation ────────────────────────────────────────────────────────

/**
 * Determines whether ArcenPay should sponsor gas for this transaction.
 */
export async function shouldSponsorGas(
    teamId: string,
    chainId: number,
    txType: SponsoredTxType = "other",
    walletAddress?: string,
): Promise<SponsorDecision> {
    // Rule 1: Only L2 chains are eligible
    if (BLOCKED_CHAIN_IDS.has(chainId)) {
        return {
            sponsor: false,
            reason: `Gas sponsorship is not available on chain ${chainId} (L1). Only L2 chains are supported.`,
        };
    }

    if (!SPONSORED_CHAIN_IDS.has(chainId)) {
        return {
            sponsor: false,
            reason: `Chain ${chainId} is not configured for gas sponsorship.`,
        };
    }

    // Rule 2: Only certain tx types are sponsored
    if (!SPONSORABLE_TX_TYPES.has(txType)) {
        return {
            sponsor: false,
            reason: `Transaction type "${txType}" is not eligible for gas sponsorship.`,
        };
    }

    // Rule 3: Check team exists and tier config
    const team = await db.team.findUnique({
        where: { id: teamId },
        select: { platformTier: true },
    });
    if (!team) {
        return { sponsor: false, reason: "Team not found." };
    }

    // Rule 4: Check if gas sponsorship is enabled for this tier
    const tierConfig = await db.platformTierConfig.findUnique({
        where: { tier: team.platformTier },
    });
    if (tierConfig && !tierConfig.gasSponsored) {
        return {
            sponsor: false,
            reason: `Gas sponsorship is disabled for the ${team.platformTier} tier.`,
        };
    }

    // Rule 5: Check per-wallet abuse limit
    if (walletAddress) {
        const abuseCheck = await checkWalletAbuseLimit(teamId, walletAddress);
        if (!abuseCheck.allowed) {
            return {
                sponsor: false,
                reason: `Wallet ${walletAddress} has exceeded the daily sponsored transaction limit (${abuseCheck.limit}).`,
            };
        }
    }

    // Rule 6: Check daily gas budget
    const budgetInfo = await getDailyGasSpend(teamId);
    if (budgetInfo.remainingUsd <= 0) {
        return {
            sponsor: false,
            reason: `Daily gas budget exhausted ($${budgetInfo.spentTodayUsd.toFixed(4)} / $${budgetInfo.dailyBudgetUsd.toFixed(2)}).`,
        };
    }

    return {
        sponsor: true,
        reason: `Gas sponsored on ${team.platformTier} tier. Budget remaining: $${budgetInfo.remainingUsd.toFixed(4)}.`,
    };
}

// ── Paymaster request handler ────────────────────────────────────────────────

/**
 * Evaluates a paymaster sponsorship request.
 * This is the entry point called by the facilitator service when a user
 * submits a UserOperation that needs gas sponsorship.
 */
export async function evaluatePaymasterRequest(
    req: PaymasterRequest,
): Promise<PaymasterResponse> {
    const decision = await shouldSponsorGas(
        req.teamId,
        req.chainId,
        req.txType,
        req.walletAddress,
    );

    if (!decision.sponsor) {
        return { sponsored: false, reason: decision.reason };
    }

    // In production, this would call the actual paymaster service
    // (e.g., Pimlico, Biconomy, or a self-hosted ERC-4337 paymaster)
    // and return the paymasterAndData for the UserOperation.
    //
    // For now, return a placeholder indicating sponsorship is approved.
    // The facilitator service will use this to construct the actual
    // paymaster data when submitting the UserOperation to the bundler.

    const budgetInfo = await getDailyGasSpend(req.teamId);

    return {
        sponsored: true,
        paymasterAndData: "0x", // Placeholder — facilitator fills this
        maxGasCostUsd: Math.min(budgetInfo.remainingUsd, 0.50), // cap per-tx
    };
}

// ── Budget tracking ──────────────────────────────────────────────────────────

/**
 * Returns the current daily gas spend summary for a team.
 */
export async function getDailyGasSpend(teamId: string): Promise<GasBudgetInfo> {
    const team = await db.team.findUnique({
        where: { id: teamId },
        select: { platformTier: true },
    });

    const tier = team?.platformTier ?? "FREE";
    const limits = await getTierLimits(tier);
    const dailyBudgetUsd = limits.gasDailyBudgetUsd;

    const tierConfig = await db.platformTierConfig.findUnique({
        where: { tier },
    });

    // Sum today's gas spend
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const [result, txCountResult] = await Promise.all([
        db.gasSpend.aggregate({
            where: {
                teamId,
                createdAt: { gte: todayStart },
            },
            _sum: { gasCostUsd: true },
        }),
        db.gasSpend.count({
            where: {
                teamId,
                createdAt: { gte: todayStart },
            },
        }),
    ]);

    const spentTodayUsd = Number(result._sum.gasCostUsd ?? 0);
    const remainingUsd = Math.max(0, dailyBudgetUsd - spentTodayUsd);

    return {
        tier,
        dailyBudgetUsd,
        spentTodayUsd,
        remainingUsd,
        isGasSponsored: tierConfig?.gasSponsored ?? true,
        budgetAlertTriggered: spentTodayUsd >= dailyBudgetUsd * BUDGET_ALERT_THRESHOLD,
        txCountToday: txCountResult,
    };
}

// ── Recording gas spend ──────────────────────────────────────────────────────

/**
 * Records a gas spend event after a sponsored transaction.
 */
export async function recordGasSpend(params: {
    teamId: string;
    chainId: number;
    txHash: string;
    gasUsedWei: string;
    gasCostUsd: number;
    walletAddress?: string;
}): Promise<void> {
    await db.gasSpend.create({
        data: {
            teamId: params.teamId,
            chainId: params.chainId,
            txHash: params.txHash,
            gasUsedWei: params.gasUsedWei,
            gasCostUsd: new Prisma.Decimal(params.gasCostUsd),
            walletAddress: params.walletAddress ?? null,
        },
    });
}

// ── Anti-abuse check ─────────────────────────────────────────────────────────

/**
 * Checks whether a specific wallet has exceeded the daily sponsored tx limit.
 * This prevents any single wallet from draining the gas budget.
 */
export async function checkWalletAbuseLimit(
    teamId: string,
    walletAddress: string,
): Promise<{ allowed: boolean; txCount: number; limit: number }> {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const txCount = await db.gasSpend.count({
        where: {
            teamId,
            walletAddress,
            createdAt: { gte: todayStart },
        },
    });

    return {
        allowed: txCount < MAX_SPONSORED_TXS_PER_WALLET_PER_DAY,
        txCount,
        limit: MAX_SPONSORED_TXS_PER_WALLET_PER_DAY,
    };
}

/**
 * Returns whether a chain ID is eligible for gas sponsorship.
 * Utility for the React SDK to check before initiating a sponsored tx.
 */
export function isChainSponsorEligible(chainId: number): boolean {
    return SPONSORED_CHAIN_IDS.has(chainId);
}

/**
 * Returns the gas spend history for a team over the last N days.
 * Used by the dashboard gas budget widget.
 */
export async function getGasSpendHistory(
    teamId: string,
    days: number = 7,
): Promise<{ date: string; totalUsd: number; txCount: number }[]> {
    const startDate = new Date();
    startDate.setUTCDate(startDate.getUTCDate() - days);
    startDate.setUTCHours(0, 0, 0, 0);

    const spends = await db.gasSpend.findMany({
        where: {
            teamId,
            createdAt: { gte: startDate },
        },
        select: {
            createdAt: true,
            gasCostUsd: true,
        },
        orderBy: { createdAt: "asc" },
    });

    // Group by date
    const byDate = new Map<string, { totalUsd: number; txCount: number }>();

    for (let i = 0; i <= days; i++) {
        const d = new Date(startDate);
        d.setUTCDate(d.getUTCDate() + i);
        const key = d.toISOString().split("T")[0];
        byDate.set(key, { totalUsd: 0, txCount: 0 });
    }

    for (const spend of spends) {
        const key = spend.createdAt.toISOString().split("T")[0];
        const entry = byDate.get(key);
        if (entry) {
            entry.totalUsd += Number(spend.gasCostUsd);
            entry.txCount += 1;
        }
    }

    return Array.from(byDate.entries()).map(([date, data]) => ({
        date,
        ...data,
    }));
}
