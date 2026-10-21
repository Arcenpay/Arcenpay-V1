/**
 * One-off: make a workspace its own ArcenPay provider (platform dogfooding).
 *
 * Provisions, against the database the process is pointed at:
 *   1. a Solana environment (default Solana mainnet 9100000)
 *   2. the provider Solana wallet on the owner's user record
 *   3. FREE / Pro / Enterprise catalog plans (published) + entitlements/flags
 *   4. the platform subscription company, embedded portal component,
 *      PlatformBillingCustomer and PlatformBillingAccount
 *   5. an initial FREE subscription state + catalog config
 *
 * Idempotent. Dry-run by default; pass --apply to write.
 *
 * Usage:
 *   npx tsx scripts/dogfood-platform-billing.ts \
 *     --email aditya@arcenpay.com \
 *     --wallet Fs9Jp5jQMHCLyJR8eLqP7mQxNPS7iSZuDzn5c2bL2Bgc \
 *     --chain-id 9100000 [--team-id <id>] [--apply]
 *
 * NOTE: PLATFORM_BILLING_* is overridden in-process so the plans are built for
 * the requested chain. The running backend/facilitator MUST be configured with
 * the same values or live enrollment will keep using the old chain.
 */

const SOLANA_MAINNET = 9100000;
const USDC_BY_SOLANA_CHAIN: Record<number, string> = {
  9100000: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // mainnet USDC
  9100001: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", // devnet USDC
};
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const PLATFORM_COMPONENT_NAME = "ArcenPay Platform Billing";

type Args = {
  email: string;
  wallet: string;
  chainId: number;
  teamId: string | null;
  apply: boolean;
};

function readArgs(): Args {
  const argv = process.argv.slice(2);
  const value = (flag: string, fallback: string) => {
    const i = argv.indexOf(flag);
    return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
  };
  return {
    email: value("--email", "aditya@arcenpay.com"),
    wallet: value("--wallet", "Fs9Jp5jQMHCLyJR8eLqP7mQxNPS7iSZuDzn5c2bL2Bgc"),
    chainId: Number(value("--chain-id", String(SOLANA_MAINNET))),
    teamId: value("--team-id", "") || null,
    apply: argv.includes("--apply"),
  };
}

const args = readArgs();
const log = (msg: string) => console.log(`[dogfood] ${msg}`);
const would = (msg: string) => console.log(`[dogfood] ${args.apply ? "" : "DRY-RUN "}${msg}`);

if (!Number.isFinite(args.chainId)) {
  console.error("Invalid --chain-id");
  process.exit(1);
}
const usdcMint = USDC_BY_SOLANA_CHAIN[args.chainId];
if (!usdcMint) {
  console.error(
    `Unsupported chain ${args.chainId}: this script only provisions Solana ` +
      `mainnet (9100000) or devnet (9100001).`,
  );
  process.exit(1);
}
if (!BASE58_RE.test(args.wallet)) {
  console.error(`Invalid Solana wallet: ${args.wallet}`);
  process.exit(1);
}

// Must run before importing any module that snapshots config.ts.
process.env.PLATFORM_BILLING_CHAIN_ID = String(args.chainId);
process.env.PLATFORM_BILLING_TREASURY_ADDRESS = args.wallet;
process.env.PLATFORM_BILLING_ACCEPTED_TOKEN = usdcMint;

const { db } = await import("../src/db.js");
const { toPrismaJson } = await import("../src/utils/prisma-json.js");
const {
  ensureTierCatalogPlan,
  ensurePlatformSubscriptionCompany,
} = await import("../src/lib/billing/platform-tier-billing.js");
const { upsertSubscriptionLedgerState } = await import(
  "../src/lib/billing/billing-ledger.js"
);
const { resolveChainFamilyForPrisma } = await import(
  "../src/lib/platform/chain-family.js"
);
const { writeAuditEvent } = await import("../src/lib/platform/audit.js");

async function main() {
  log(`email=${args.email} wallet=${args.wallet} chainId=${args.chainId} apply=${args.apply}`);

  if (args.chainId === SOLANA_MAINNET) {
    log(
      "Reminder: the backend and facilitator must also run with " +
        "PLATFORM_BILLING_CHAIN_ID=9100000, PLATFORM_BILLING_TREASURY_ADDRESS=" +
        args.wallet +
        ", FACILITATOR_CHAINS containing 9100000.",
    );
  }

  // ── 1. Resolve the owner and workspace ────────────────────────────────────
  const user = await db.user.findFirst({
    where: { email: { equals: args.email, mode: "insensitive" } },
    select: { id: true, email: true, solanaWalletAddress: true },
  });
  if (!user) throw new Error(`No user with email ${args.email}`);

  const memberships = await db.teamMember.findMany({
    where: { userId: user.id },
    select: {
      role: true,
      team: { select: { id: true, name: true, slug: true, platformTier: true } },
    },
    orderBy: { team: { createdAt: "asc" } },
  });

  if (memberships.length === 0) throw new Error("User belongs to no team");

  let membership = memberships[0];
  if (args.teamId) {
    const match = memberships.find((m) => m.team.id === args.teamId);
    if (!match) throw new Error(`User is not a member of team ${args.teamId}`);
    membership = match;
  } else if (memberships.length > 1) {
    console.error("User belongs to multiple teams; pass --team-id. Options:");
    for (const m of memberships) {
      console.error(`  ${m.team.id}  ${m.team.name} (${m.team.slug}) role=${m.role}`);
    }
    process.exit(1);
  }

  const team = membership.team;
  log(`Workspace: ${team.name} (${team.id}) tier=${team.platformTier}`);

  // ── 2. Environment ────────────────────────────────────────────────────────
  let environment = await db.workspaceEnvironment.findFirst({
    where: { teamId: team.id, chainId: args.chainId },
    select: { id: true, name: true, mode: true, chainId: true, chainFamily: true },
  });

  if (!environment) {
    would(`create environment "Solana Production" (PRODUCTION, chain ${args.chainId})`);
    if (args.apply) {
      environment = await db.workspaceEnvironment.create({
        data: {
          teamId: team.id,
          name: "Solana Production",
          mode: "PRODUCTION",
          chainId: args.chainId,
          chainFamily: resolveChainFamilyForPrisma(args.chainId),
        },
        select: { id: true, name: true, mode: true, chainId: true, chainFamily: true },
      });
    }
  } else {
    log(`Using environment ${environment.name} (${environment.id})`);
  }

  const environmentId = environment?.id ?? "<pending>";

  // ── 3. Provider wallet ────────────────────────────────────────────────────
  const ownerOfWallet = await db.user.findFirst({
    where: { solanaWalletAddress: args.wallet, NOT: { id: user.id } },
    select: { id: true, email: true },
  });
  if (ownerOfWallet) {
    throw new Error(
      `Wallet ${args.wallet} is already linked to user ${ownerOfWallet.email ?? ownerOfWallet.id}`,
    );
  }

  if (user.solanaWalletAddress !== args.wallet) {
    would(`link Solana wallet to ${args.email} (was ${user.solanaWalletAddress ?? "unset"})`);
    if (args.apply) {
      await db.user.update({
        where: { id: user.id },
        data: { solanaWalletAddress: args.wallet },
      });
    }
  } else {
    log("Solana wallet already linked");
  }

  if (!args.apply) {
    log("Dry run complete. Re-run with --apply to write.");
    await db.$disconnect();
    return;
  }

  if (!environment) throw new Error("Environment was not created (apply failed)");

  // ── 4. Published tier plans (creates entitlements + flag rules) ───────────
  const planIds: Record<string, string | null> = {};
  for (const tier of ["FREE", "PLUS", "PRO"] as const) {
    planIds[tier] = await ensureTierCatalogPlan(team.id, tier, {
      environmentId: environment.id,
      publish: true,
      syncOnchain: false,
    });
    log(`${tier} plan: ${planIds[tier]}`);
  }

  // ── 5. Subscription company ───────────────────────────────────────────────
  const company = await ensurePlatformSubscriptionCompany(team.id, args.wallet);
  if (company.environmentId !== environment.id) {
    await db.arcenCompany.update({
      where: { id: company.id },
      data: { environmentId: environment.id, walletAddress: args.wallet },
    });
  }
  log(`Platform company: ${company.id}`);

  // ── 6. Embed component ────────────────────────────────────────────────────
  let component = await db.embedComponent.findFirst({
    where: { teamId: team.id, name: PLATFORM_COMPONENT_NAME },
    select: { id: true, environmentId: true },
  });

  if (!component) {
    component = await db.embedComponent.create({
      data: {
        teamId: team.id,
        environmentId: environment.id,
        name: PLATFORM_COMPONENT_NAME,
        elements: toPrismaJson([
          { type: "planManager" },
          { type: "includedFeatures" },
          { type: "plansTable" },
          { type: "invoices" },
        ]),
        design: toPrismaJson({
          primaryColor: "#000000",
          secondaryColor: "#f4f4f5",
          fontFamily: "Geist, Inter, system-ui, sans-serif",
          fontSize: 14,
          fontColor: "#0f172a",
          backgroundColor: "#ffffff",
          borderRadius: 8,
          cardStyle: "minimal",
          columns: 1,
          sections: "separate",
        }),
      },
      select: { id: true, environmentId: true },
    });
    log(`Component created: ${component.id}`);
  } else if (!component.environmentId) {
    await db.embedComponent.update({
      where: { id: component.id },
      data: { environmentId: environment.id },
    });
    log(`Component ${component.id} pinned to environment`);
  } else {
    log(`Component already exists: ${component.id}`);
  }

  // ── 7. PlatformBillingAccount / Customer ──────────────────────────────────
  const existingAccount = await db.platformBillingAccount.findUnique({
    where: { environmentId: environment.id },
    select: { providerTeamId: true, portalComponentId: true },
  });
  if (existingAccount && existingAccount.providerTeamId !== team.id) {
    throw new Error(
      `Environment ${environment.id} already has a platform billing account for team ` +
        `${existingAccount.providerTeamId}. Refusing to reassign.`,
    );
  }

  await db.platformBillingAccount.upsert({
    where: {
      providerTeamId_environmentId: {
        providerTeamId: team.id,
        environmentId: environment.id,
      },
    },
    update: { portalComponentId: component.id },
    create: {
      providerTeamId: team.id,
      environmentId: environment.id,
      portalComponentId: component.id,
    },
  });
  log("PlatformBillingAccount ready");

  await db.platformBillingCustomer.upsert({
    where: { workspaceTeamId: team.id },
    update: {
      providerTeamId: team.id,
      environmentId: environment.id,
      companyId: company.id,
    },
    create: {
      workspaceTeamId: team.id,
      providerTeamId: team.id,
      environmentId: environment.id,
      companyId: company.id,
    },
  });
  log("PlatformBillingCustomer ready");

  // ── 8. Initial FREE subscription state ────────────────────────────────────
  const freePlanId = planIds.FREE;
  if (freePlanId) {
    const existingSub = await db.subscriptionState.findFirst({
      where: { companyId: company.id },
      select: { id: true },
    });
    if (!existingSub) {
      const now = new Date();
      await upsertSubscriptionLedgerState({
        teamId: team.id,
        companyId: company.id,
        environmentId: environment.id,
        status: "ACTIVE",
        catalogPlanId: freePlanId,
        walletAddress: args.wallet,
        chainId: args.chainId,
        currentPeriodStart: now,
        currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        lastEvent: "platform.dogfood.setup",
        lastEventAt: now,
        metadata: { source: "dogfood-platform-billing", tier: "FREE", isPlatformSubscription: true },
      });
      log("Initial FREE subscription state created");
    } else {
      log("Subscription state already exists");
    }
  }

  // ── 9. Catalog config ─────────────────────────────────────────────────────
  const catalogConfig = await db.catalogConfig.findUnique({
    where: { environmentId: environment.id },
  });
  if (freePlanId) {
    if (!catalogConfig) {
      await db.catalogConfig.create({
        data: {
          teamId: team.id,
          environmentId: environment.id,
          environmentMode: "PRODUCTION",
          initialPlan: freePlanId,
          fallbackPlan: freePlanId,
          livePlanIds: [freePlanId],
        },
      });
      log("Catalog config created");
    } else {
      await db.catalogConfig.update({
        where: { id: catalogConfig.id },
        data: {
          initialPlan: catalogConfig.initialPlan || freePlanId,
          fallbackPlan: catalogConfig.fallbackPlan ?? freePlanId,
          livePlanIds: Array.from(new Set([...catalogConfig.livePlanIds, freePlanId])),
        },
      });
      log("Catalog config updated");
    }
  }

  await writeAuditEvent({
    headers: new Headers({ "user-agent": "dogfood-platform-billing-script" }),
    teamId: team.id,
    userId: user.id,
    walletAddress: args.wallet,
    action: "platform.dogfood.setup",
    resourceType: "workspace",
    resourceId: team.id,
    afterData: {
      environmentId: environment.id,
      chainId: args.chainId,
      componentId: component.id,
      plans: planIds,
    },
  });

  log("");
  log("=============================================");
  log(" Platform dogfooding provisioned");
  log(` Workspace:   ${team.name} (${team.id})`);
  log(` Environment: ${environment.name} (${environment.id}) chain=${args.chainId}`);
  log(` Component:   ${component.id}`);
  log(` Plans:       FREE=${planIds.FREE} PLUS=${planIds.PLUS} PRO=${planIds.PRO}`);
  log("");
  log(" Next:");
  log("   1. Fund the Solana wallet with SOL (rent/fees) and USDC (subscription).");
  log("   2. Register the paid plans on-chain from Catalog → Plans → Sync on-chain.");
  log("   3. Subscribe from the portal to project Team.platformTier.");
  log("=============================================");

  await db.$disconnect();
}

main().catch(async (error) => {
  console.error("[dogfood] Fatal:", error instanceof Error ? error.message : error);
  try {
    await db.$disconnect();
  } catch {
    // ignore
  }
  process.exit(1);
});

export {};
