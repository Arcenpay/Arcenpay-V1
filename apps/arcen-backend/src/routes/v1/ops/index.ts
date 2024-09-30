import { Hono } from "hono";
import { getDunningPreview, runDunningSweep } from "./billing-dunning.js";
import { getDeadLetterEvents, replayDeadLetterEvents } from "./dead-letter.js";
import { replayDeadLetterById } from "./dead-letter-by-id.js";
import { migrateLegacyBillingLifecycle } from "./billing-migrate-lifecycle.js";
import { getReconciliation } from "./billing-reconciliation.js";
import { getBillingRuntime } from "./billing-runtime.js";
import { getGaReadiness } from "./ga-readiness.js";
import { getWorkerHealth } from "./worker-health.js";

export const opsRoutes = new Hono()
  .get("/billing/dunning", getDunningPreview)
  .post("/billing/dunning", runDunningSweep)
  .get("/billing/reconciliation", getReconciliation)
  .get("/billing/runtime", getBillingRuntime)
  .post("/billing/migrate-lifecycle", migrateLegacyBillingLifecycle)
  .get("/billing-events/dead-letter", getDeadLetterEvents)
  .post("/billing-events/dead-letter", replayDeadLetterEvents)
  .post("/billing-events/dead-letter/:id", replayDeadLetterById)
  .get("/ga-readiness", getGaReadiness)
  .get("/worker-health", getWorkerHealth);
