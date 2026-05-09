import { Hono } from "hono";
import { requireFacilitatorAuth } from "../../../middleware/auth.js";
import { getAgentConfigs } from "./agent-configs.js";
import { runBillingMaintenance } from "../../../lib/billing/billing-maintenance.js";
import { runMaintenanceAll } from "./billing-maintenance-all.js";
import { resolvePlan } from "./catalog-resolve-plan.js";
import { syncSubscription } from "./companies-sync-subscription.js";
import { createPreviewToken } from "./preview-token.js";

export const internalRoutes = new Hono()
  .get("/agent/configs", requireFacilitatorAuth(), getAgentConfigs)
  .post("/billing/maintenance", requireFacilitatorAuth(), runBillingMaintenance)
  .post("/billing/maintenance/all", requireFacilitatorAuth(), runMaintenanceAll)
  .get("/catalog/resolve-plan", requireFacilitatorAuth(), resolvePlan)
  .patch("/companies/sync-subscription", requireFacilitatorAuth(), syncSubscription)
  .post("/preview-token", createPreviewToken);
