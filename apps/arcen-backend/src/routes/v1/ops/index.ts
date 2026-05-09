import { Hono, type Context } from "hono";
import { runBillingDunningSweep } from "../../../lib/billing/billing-dunning.js";
import { getBillingReconciliationSummary } from "../../../lib/billing/billing-reconciliation.js";
import { getDeadLetterEvents, replayDeadLetterEvents } from "./dead-letter.js";
import { replayDeadLetterById } from "./dead-letter-by-id.js";
import { getGaReadiness } from "./ga-readiness.js";
import { getWorkerHealth } from "./worker-health.js";

async function runDunning(c: Context) {
  return c.json(await runBillingDunningSweep({ now: new Date() }));
}

async function getReconciliation(c: Context) {
  return c.json(await getBillingReconciliationSummary({ teamId: c.get("apiKeyTeamId") ?? (c.get("team") as any)?.teamId, now: new Date() }));
}

export const opsRoutes = new Hono()
  .get("/billing/dunning", runDunning)
  .post("/billing/dunning", runDunning)
  .get("/billing/reconciliation", getReconciliation)
  .get("/billing-events/dead-letter", getDeadLetterEvents)
  .post("/billing-events/dead-letter", replayDeadLetterEvents)
  .post("/billing-events/dead-letter/:id", replayDeadLetterById)
  .get("/ga-readiness", getGaReadiness)
  .get("/worker-health", getWorkerHealth);
