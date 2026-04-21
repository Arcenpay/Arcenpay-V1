// ============================================================
//  Dashboard — Ops: GA Readiness Gate
//  GET /api/ops/ga-readiness
//
//  Aggregates all pre-GA checks into a single machine-readable
//  report.  Returns HTTP 200 with { ready: true } when all gates
//  pass, or HTTP 200 with { ready: false, gates: [...] } listing
//  every failing gate so operators can action each one.
//
//  Access: OWNER or ADMIN only.
//  Phase 7 — run before every production cutover.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth.server";
import { resolveTeamContext } from "@/lib/team-session";
import {
  FACILITATOR_URL,
  FACILITATOR_SECRET,
  GRAPH_URL,
  RESEND_API_KEY,
  SIWE_JWT_SECRET,
  INVOICE_DOWNLOAD_SIGNING_SECRET,
} from "@/lib/config";
import { checkSubgraphHealth } from "@/lib/graphql";
import { getBillingReconciliationSummary } from "@/lib/billing-reconciliation";

interface Gate {
  id: string;
  description: string;
  passed: boolean;
  detail?: string;
}

async function requireAdmin(req: NextRequest) {
  const session = await getSession();
  if (!session) return null;
  const team = await resolveTeamContext(session);
  if (!team) return null;
  if (team.teamRole !== "OWNER" && team.teamRole !== "ADMIN") return null;
  return { session, team };
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const gates: Gate[] = [];
  const isProd = process.env.NODE_ENV === "production";

  // ── Gate 1: Required env vars ────────────────────────────────
  const missingEnvVars: string[] = [];
  if (!GRAPH_URL) missingEnvVars.push("NEXT_PUBLIC_GRAPH_URL");
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

  // ── Gate 2: Database connectivity ────────────────────────────
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

  // ── Gate 3: Subgraph health ───────────────────────────────────
  const subgraphHealth = await checkSubgraphHealth().catch(() => ({
    healthy: false,
    lagSeconds: null,
    latestBlock: null,
    error: "health check threw",
  }));
  const subgraphLagOk = subgraphHealth.lagSeconds == null || subgraphHealth.lagSeconds < 120;
  gates.push({
    id: "subgraph",
    description: "Subgraph is reachable, healthy, and within 120s of chain tip",
    passed: subgraphHealth.healthy && subgraphLagOk,
    detail: subgraphHealth.error
      ? subgraphHealth.error
      : subgraphHealth.lagSeconds != null
        ? `Lag: ${subgraphHealth.lagSeconds}s, latestBlock: ${subgraphHealth.latestBlock}`
        : "Lag unknown",
  });

  // ── Gate 4: Facilitator health ───────────────────────────────
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

  // ── Gate 5: No pending catalog chain sync (production) ───────
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

  // ── Gate 6: No unprocessed billing events ────────────────────
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

  // ── Gate 7: Ledger reconciliation clean ─────────────────────
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

  // ── Gate 8: Email provider configured (production only) ──────
  gates.push({
    id: "email_provider",
    description: "Email provider (Resend) is configured",
    passed: !isProd || Boolean(RESEND_API_KEY),
    detail: !RESEND_API_KEY ? "RESEND_API_KEY is not set — transactional emails will silently fail." : undefined,
  });

  // ── Gate 9: Team has at least one published plan ──────────────
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

  return NextResponse.json({
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
