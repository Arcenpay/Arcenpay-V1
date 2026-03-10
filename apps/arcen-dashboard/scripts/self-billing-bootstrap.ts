// ============================================================
//  ArcenPay Self-Billing Bootstrap Script
//
//  One-time setup that:
//  1. Seeds PlatformTierConfig rows for FREE, PLUS, PRO
//  2. (Future) Registers ArcenPay as a provider in PlanFactory
//     and creates on-chain plans for tier upgrades
//
//  Run with: npx tsx scripts/self-billing-bootstrap.ts
// ============================================================

import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const db = new PrismaClient({ adapter });

async function main() {
    console.log("🚀 ArcenPay Self-Billing Bootstrap\n");

    // ── Step 1: Seed PlatformTierConfig ────────────────────────────────────────

    const tiers = [
        {
            tier: "FREE" as const,
            maxWorkspaces: 1,
            maxPlans: 2,
            maxSubscribers: 200,
            maxTeamMembers: 1,
            maxFeatureFlags: 5,
            maxChains: 1,
            platformFeeBps: 200, // 2.0%
            gasSponsored: true,
            gasDailyBudgetUsd: 1.0,
        },
        {
            tier: "PLUS" as const,
            maxWorkspaces: 3,
            maxPlans: 15,
            maxSubscribers: 50_000,
            maxTeamMembers: 10,
            maxFeatureFlags: 999,
            maxChains: 3,
            platformFeeBps: 100, // 1.0%
            gasSponsored: true,
            gasDailyBudgetUsd: 10.0,
        },
        {
            tier: "PRO" as const,
            maxWorkspaces: 999,
            maxPlans: 999,
            maxSubscribers: 999_999,
            maxTeamMembers: 999,
            maxFeatureFlags: 999,
            maxChains: 999,
            platformFeeBps: 50, // 0.5%
            gasSponsored: true,
            gasDailyBudgetUsd: 100.0,
        },
    ];

    for (const tier of tiers) {
        await db.platformTierConfig.upsert({
            where: { tier: tier.tier },
            update: {
                maxWorkspaces: tier.maxWorkspaces,
                maxPlans: tier.maxPlans,
                maxSubscribers: tier.maxSubscribers,
                maxTeamMembers: tier.maxTeamMembers,
                maxFeatureFlags: tier.maxFeatureFlags,
                maxChains: tier.maxChains,
                platformFeeBps: tier.platformFeeBps,
                gasSponsored: tier.gasSponsored,
                gasDailyBudgetUsd: tier.gasDailyBudgetUsd,
            },
            create: tier,
        });
        console.log(
            `  ✅ Upserted ${tier.tier} tier config (fee: ${tier.platformFeeBps / 100}%, plans: ${tier.maxPlans}, gas: $${tier.gasDailyBudgetUsd}/day)`,
        );
    }

    // ── Step 2: Summary ────────────────────────────────────────────────────────

    console.log("\n🎉 Bootstrap complete!\n");
    console.log("Tier comparison:");
    console.log("┌─────────┬──────────┬───────┬─────────┬──────────┬────────────┬───────────┐");
    console.log("│  Tier   │ Fee Rate │ Plans │ Members │ Subs     │ Gas Budget │ Price     │");
    console.log("├─────────┼──────────┼───────┼─────────┼──────────┼────────────┼───────────┤");

    const prices = { FREE: 0, PLUS: 29, PRO: 99 };
    for (const t of tiers) {
        const price = prices[t.tier];
        console.log(
            `│ ${t.tier.padEnd(7)} │ ${(t.platformFeeBps / 100).toFixed(1)}%     │ ${String(t.maxPlans).padEnd(5)} │ ${String(t.maxTeamMembers).padEnd(7)} │ ${String(t.maxSubscribers).padEnd(8)} │ $${t.gasDailyBudgetUsd.toFixed(2).padStart(6)}/day │ $${String(price).padStart(3)}/mo    │`,
        );
    }
    console.log("└─────────┴──────────┴───────┴─────────┴──────────┴────────────┴───────────┘");

    console.log("\n📝 Next steps:");
    console.log("  1. Run prisma migrate dev to apply schema changes");
    console.log("  2. Deploy updated FeeCollector.sol with syncProviderTier()");
    console.log("  3. Call syncProviderTier() for each provider based on their tier");
    console.log("  4. Set up ERC-4337 paymaster or relay service for gas sponsorship");
}

main()
    .catch((err) => {
        console.error("❌ Bootstrap failed:", err);
        process.exit(1);
    })
    .finally(async () => {
        await db.$disconnect();
        await pool.end();
    });
