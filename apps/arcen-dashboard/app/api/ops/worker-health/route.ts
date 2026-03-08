// ============================================================
//  Dashboard — Ops: Worker & Queue Health
//  GET /api/ops/worker-health
//
//  Aggregates facilitator queue stats, SLO state, and subgraph
//  health into a single operator dashboard payload.
//  Access: authenticated session (any role).
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth.server";
import { FACILITATOR_URL, FACILITATOR_SECRET } from "@/lib/config";
import { checkSubgraphHealth } from "@/lib/graphql";

export async function GET(_request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Fetch facilitator health and subgraph health in parallel
  const [facilitatorResult, subgraphResult] = await Promise.allSettled([
    fetch(`${FACILITATOR_URL}/health`, {
      headers: FACILITATOR_SECRET ? { Authorization: `Bearer ${FACILITATOR_SECRET}` } : {},
      signal: AbortSignal.timeout(5_000),
      cache: "no-store",
    }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))),
    checkSubgraphHealth(),
  ]);

  const facilitator =
    facilitatorResult.status === "fulfilled"
      ? {
          reachable: true,
          status: (facilitatorResult.value as { status?: string }).status ?? "unknown",
          queues: (facilitatorResult.value as { queues?: unknown }).queues ?? null,
          slo: (facilitatorResult.value as { slo?: unknown }).slo ?? null,
          replayProtection: (facilitatorResult.value as { replayProtection?: unknown }).replayProtection ?? null,
          settlement: (facilitatorResult.value as { settlement?: unknown }).settlement ?? null,
          blockNumber: (facilitatorResult.value as { blockNumber?: string | null }).blockNumber ?? null,
        }
      : {
          reachable: false,
          error:
            facilitatorResult.reason instanceof Error
              ? facilitatorResult.reason.message
              : "Unknown error",
        };

  const subgraph =
    subgraphResult.status === "fulfilled"
      ? subgraphResult.value
      : {
          healthy: false,
          lagSeconds: null,
          latestBlock: null,
          error:
            subgraphResult.reason instanceof Error
              ? subgraphResult.reason.message
              : "Unknown error",
        };

  const overallHealthy =
    (facilitator as { reachable: boolean }).reachable &&
    subgraph.healthy &&
    ((facilitator as { slo?: { ok: boolean } }).slo?.ok ?? true);

  return NextResponse.json({
    healthy: overallHealthy,
    generatedAt: new Date().toISOString(),
    facilitator,
    subgraph,
  });
}
