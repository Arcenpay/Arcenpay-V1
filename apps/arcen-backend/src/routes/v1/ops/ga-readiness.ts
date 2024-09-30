import type { Context } from "hono";
import { db } from "../../../db.js";
import {
  FACILITATOR_URL,
  FACILITATOR_SECRET,
  RESEND_API_KEY,
  SIWE_JWT_SECRET,
  INVOICE_DOWNLOAD_SIGNING_SECRET,
} from "../../../config.js";
import { checkSubgraphHealth } from "../../../lib/platform/graphql.js";
import { getBillingReconciliationSummary } from "../../../lib/billing/billing-reconciliation.js";
import { getBillingRuntimeSummary } from "../../../lib/billing/billing-runtime.js";
import { SUBGRAPH_REQUIRED } from "../../../lib/platform/launch-flags.js";
import { requireTeamRoles, isErrorResponse } from "../../../lib/auth/api-auth.js";

interface Gate {
  id: string;
  description: string;
  passed: boolean;
  detail?: string;
}

export async function getGaReadiness(c: Context) {
  const auth = await requireTeamRoles(c, ["OWNER", "ADMIN"]);
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const gates: Gate[] = [];
  const isProd = process.env.NODE_ENV === "production";

  const missingEnvVars: string[] = [];
  if (!RESEND_API_KEY) missingEnvVars.push("RESEND_API_KEY");
  if (!SIWE_JWT_SECRET || SIWE_JWT_SECRET === "dev_siwe_jwt_secret_not_for_production") {
    missingEnvVars.push("SIWE_JWT_SECRET");
  }
  if (!INVOICE_DOWNLOAD_SIGNING_SECRET) missingEnvVars.push("INVOICE_DOWNLOAD_SIGNING_SECRET");
  if (!process.env.DATABASE_URL) missingEnvVars.push("DATABASE_URL");

  gates.push({
    id: "env_vars",
    description: "All required environment variables are set",
    passed: missingEnvVars.length === 0,
    detail: missingEnvVars.length > 0 ? `Missing: ${missingEnvVars.join(", ")}` : undefined,
  });

  let dbOk = false;
  let dbDetail: string | undefined;
  try {
    await db.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch (err) {
    dbDetail = err instanceof Error ? err.message : "Unknown DB error";
  }
  gates.push({
    id: "database",
    description: "Database is reachable and accepts queries",
    passed: dbOk,
    detail: dbDetail,
  });

  const subgraphHealth = SUBGRAPH_REQUIRED
    ? await checkSubgraphHealth().catch(() => ({
        healthy: false,
        lagSeconds: null,
        latestBlock: null,
        error: "health check threw",
      }))
    : { healthy: true, lagSeconds: null, latestBlock: null, error: undefined };
  const subgraphLagOk = subgraphHealth.lagSeconds == null || subgraphHealth.lagSeconds < 120;
  gates.push({
    id: "subgraph",
    description: SUBGRAPH_REQUIRED
      ? "Subgraph is reachable, healthy, and within 120s of chain tip"
      : "Subgraph is optional for this launch profile",
    passed: subgraphHealth.healthy && subgraphLagOk,
    detail: SUBGRAPH_REQUIRED
      ? subgraphHealth.error
      ? subgraphHealth.error
      : subgraphHealth.lagSeconds != null
        ? `Lag: ${subgraphHealth.lagSeconds}s, latestBlock: ${subgraphHealth.latestBlock}`
        : "Lag unknown"
      : "Skipped for MVP launch profile",
  });

  let facilitatorOk = false;
  let facilitatorDetail: string | undefined;
  let facilitatorSloOk = false;
  try {
    const res = await fetch(`${FACILITATOR_URL}/health`, {
      headers: FACILITATOR_SECRET ? { Authorization: `Bearer ${FACILITATOR_SECRET}` } : {},
      signal: AbortSignal.timeout(5_000),
    });
    if (res.ok) {
      const body = await res.json() as { slo?: { ok: boolean; breaches?: string[] } };
      facilitatorOk = true;
      facilitatorSloOk = body?.slo?.ok ?? true;
      if (!facilitatorSloOk && body?.slo?.breaches?.length) {
        facilitatorDetail = `SLO breaches: ${body.slo.breaches.join("; ")}`;
      }
    } else {
      facilitatorDetail = `HTTP ${res.status}`;
    }
  } catch (err) {
    facilitatorDetail = err instanceof Error ? err.message : "Unreachable";
  }
  gates.push({
    id: "facilitator_reachable",
    description: "Facilitator server is reachable and returns healthy",
    passed: facilitatorOk,
    detail: !facilitatorOk ? facilitatorDetail : undefined,
  });
  gates.push({
    id: "facilitator_slo",
    description: "Facilitator SLO checks all pass (no dead-letter, no RPC outage)",
    passed: facilitatorSloOk,
    detail: facilitatorDetail,
  });

  const pendingChainSync = await db.catalogPlan.count({
    where: {
      teamId: auth.team.teamId,
      environmentMode: "PRODUCTION",
      status: "PUBLISHED",
      chainSyncStatus: "PENDING",
    },
  });
  gates.push({
    id: "catalog_chain_sync",
    description: "No production catalog plans are waiting for on-chain registration",
    passed: pendingChainSync === 0,
    detail: pendingChainSync > 0
      ? `${pendingChainSync} plan(s) in PENDING state. Run PlanFactory.createPlan() and POST /api/catalog/plans/:id/chain-confirm.`
      : undefined,
  });

  const unprocessedEvents = await db.billingEvent.count({
    where: { teamId: auth.team.teamId, processed: false },
  });
  gates.push({
    id: "billing_events_drained",
    description: "No unprocessed billing events in dead-letter queue",
    passed: unprocessedEvents === 0,
    detail: unprocessedEvents > 0
      ? `${unprocessedEvents} unprocessed event(s). Use POST /api/ops/billing-events/dead-letter to replay.`
      : undefined,
  });

  const reconciliation = await getBillingReconciliationSummary({
    teamId: auth.team.teamId,
  });
  const reconciliationIssues = Object.values(reconciliation.counts).reduce(
    (sum, value) => sum + value,
    0,
  );
  gates.push({
    id: "billing_reconciliation",
    description: "Billing ledger has no known invoice/subscription/payment mismatches",
    passed: reconciliationIssues === 0,
    detail:
      reconciliationIssues > 0
        ? JSON.stringify(reconciliation.counts)
        : undefined,
  });

  const billingRuntime = await getBillingRuntimeSummary({
    teamId: auth.team.teamId,
    limit: 25,
  });

  const failedRecoveryTasks = billingRuntime.recoveryTasks.failed;
  gates.push({
    id: "billing_recovery_queue",
    description: "No failed billing recovery tasks are waiting for manual intervention",
    passed: failedRecoveryTasks === 0,
    detail:
      failedRecoveryTasks > 0
        ? `${failedRecoveryTasks} failed recovery task(s). Check GET /api/v1/ops/billing/runtime.`
        : undefined,
  });

  const staleLifecycleRequests = billingRuntime.failedLifecycleRequests.staleSync;
  gates.push({
    id: "billing_lifecycle_sync",
    description: "No stale subscription lifecycle requests are waiting on missing chain sync",
    passed: staleLifecycleRequests === 0,
    detail:
      staleLifecycleRequests > 0
        ? `${staleLifecycleRequests} stale lifecycle request(s). Check GET /api/v1/ops/billing/runtime.`
        : undefined,
  });

  const recentWebhookFailures = billingRuntime.webhookDeliveries.recentFailures24h;
  gates.push({
    id: "webhook_delivery",
    description: "No webhook deliveries failed in the last 24 hours",
    passed: recentWebhookFailures === 0,
    detail:
      recentWebhookFailures > 0
        ? `${recentWebhookFailures} webhook delivery failure(s) in the last 24h. Check GET /api/v1/ops/billing/runtime.`
        : undefined,
  });

  const remainingLegacyTransitions = billingRuntime.legacyTransitions.open;
  gates.push({
    id: "billing_legacy_lifecycle",
    description: "No open legacy trait-based lifecycle transitions remain unmigrated",
    passed: remainingLegacyTransitions === 0,
    detail:
      remainingLegacyTransitions > 0
        ? `${remainingLegacyTransitions} open legacy transition(s) still need materialization. Check GET /api/v1/ops/billing/runtime.`
        : undefined,
  });

  gates.push({
    id: "email_provider",
    description: "Email provider (Resend) is configured",
    passed: !isProd || Boolean(RESEND_API_KEY),
    detail: !RESEND_API_KEY ? "RESEND_API_KEY is not set — transactional emails will silently fail." : undefined,
  });

  const publishedPlans = await db.catalogPlan.count({
    where: {
      teamId: auth.team.teamId,
      environmentMode: "PRODUCTION",
      status: "PUBLISHED",
    },
  });
  gates.push({
    id: "production_plans_exist",
    description: "At least one production catalog plan is published",
    passed: publishedPlans > 0,
    detail: publishedPlans === 0
      ? "No PRODUCTION plans published. Publish at least one plan before GA."
      : `${publishedPlans} published plan(s).`,
  });

  const failedGates = gates.filter((g) => !g.passed);
  const ready = failedGates.length === 0;

  return c.json({
    ready,
    generatedAt: new Date().toISOString(),
    teamId: auth.team.teamId,
    totalGates: gates.length,
    passed: gates.filter((g) => g.passed).length,
    failed: failedGates.length,
    gates,
    ...(ready
      ? { message: "All GA gates pass. Ready for production cutover." }
      : {
          message: `${failedGates.length} gate(s) failed. Resolve all issues before cutover.`,
          failedGates: failedGates.map((g) => g.id),
        }),
  });
}
