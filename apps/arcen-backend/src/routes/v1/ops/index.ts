import { Hono } from "hono";
import { runBillingDunningSweep } from "../../../lib/billing/billing-dunning.js";
import { getBillingReconciliationSummary } from "../../../lib/billing/billing-reconciliation.js";
import { getDeadLetterEvents, replayDeadLetterEvents } from "./dead-letter.js";
import { replayDeadLetterById } from "./dead-letter-by-id.js";
import { getGaReadiness } from "./ga-readiness.js";
import { getWorkerHealth } from "./worker-health.js";

export const opsRoutes = new Hono()
  .get("/billing/dunning", runBillingDunningSweep)
  .post("/billing/dunning", runBillingDunningSweep)
  .get("/billing/reconciliation", getBillingReconciliationSummary)
  .get("/billing-events/dead-letter", getDeadLetterEvents)
  .post("/billing-events/dead-letter", replayDeadLetterEvents)
  .post("/billing-events/dead-letter/:id", replayDeadLetterById)
  .get("/ga-readiness", getGaReadiness)
  .get("/worker-health", getWorkerHealth);
