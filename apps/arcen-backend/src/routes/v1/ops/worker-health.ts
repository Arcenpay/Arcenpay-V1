import type { Context } from "hono";
import { requireTeamRoles, isErrorResponse } from "../../../lib/auth/api-auth.js";
import { FACILITATOR_URL, FACILITATOR_SECRET } from "../../../config.js";
import { checkSubgraphHealth } from "../../../lib/platform/graphql.js";

export async function getWorkerHealth(c: Context) {
  // SECURITY: this exposes facilitator queue/SLO/settlement internals. It is
  // OWNER/ADMIN-only, like every sibling ops route — previously any logged-in
  // user of any team could read it.
  const auth = await requireTeamRoles(c, ["OWNER", "ADMIN"]);
  if (isErrorResponse(auth)) {
    return c.json({ ok: false, error: auth.error }, auth.status as any);
  }

  const [facilitatorResult, subgraphResult] = await Promise.allSettled([
    fetch(`${FACILITATOR_URL}/health`, {
      headers: FACILITATOR_SECRET ? { Authorization: `Bearer ${FACILITATOR_SECRET}` } : {},
      signal: AbortSignal.timeout(5_000),
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

  return c.json({
    healthy: overallHealthy,
    generatedAt: new Date().toISOString(),
    facilitator,
    subgraph,
  });
}
