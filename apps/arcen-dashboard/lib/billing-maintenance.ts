import { getBillingReconciliationSummary } from "@/lib/billing-reconciliation";
import { runBillingDunningSweep } from "@/lib/billing-dunning";
import { processPendingBillingRecoveryTasks } from "@/lib/billing-recovery";
import { db } from "@/lib/db";

export async function runBillingMaintenance(input: {
  teamId: string;
  executeDunning?: boolean;
  limit?: number;
  now?: Date;
}) {
  const now = input.now ?? new Date();

  const reconciliationBefore = await getBillingReconciliationSummary({
    teamId: input.teamId,
    now,
  });

  const recovery = await processPendingBillingRecoveryTasks({
    teamId: input.teamId,
    now,
    limit: input.limit ?? 100,
  });

  const dunning =
    input.executeDunning
      ? await runBillingDunningSweep({
          teamId: input.teamId,
          now,
          limit: input.limit ?? 100,
        })
      : {
          scanned: 0,
          enforced: 0,
          skipped: 0,
          results: [],
          dryRun: true,
        };

  const reconciliationAfter = await getBillingReconciliationSummary({
    teamId: input.teamId,
    now,
  });

  return {
    executedAt: now.toISOString(),
    teamId: input.teamId,
    executeDunning: Boolean(input.executeDunning),
    reconciliationBefore,
    recovery,
    dunning,
    reconciliationAfter,
  };
}

export async function runBillingMaintenanceForAllTeams(input?: {
  executeDunning?: boolean;
  limitPerTeam?: number;
  teamLimit?: number;
  now?: Date;
}) {
  const now = input?.now ?? new Date();
  const teams = await db.team.findMany({
    where: {
      OR: [
        { arcenCompanies: { some: {} } },
        { invoices: { some: {} } },
        { billingEvents: { some: {} } },
        { subscriptionStates: { some: {} } },
        { billingRecoveryTasks: { some: {} } },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: input?.teamLimit ?? 200,
    select: { id: true, slug: true, name: true },
  });

  const results = [];
  for (const team of teams) {
    const result = await runBillingMaintenance({
      teamId: team.id,
      executeDunning: input?.executeDunning ?? false,
      limit: input?.limitPerTeam,
      now,
    });
    results.push({
      ...result,
      teamSlug: team.slug,
      teamName: team.name,
    });
  }

  return {
    executedAt: now.toISOString(),
    executeDunning: Boolean(input?.executeDunning),
    teamsProcessed: results.length,
    teams: results,
  };
}
