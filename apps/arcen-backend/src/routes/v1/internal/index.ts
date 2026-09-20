import { Hono, type Context } from "hono";
import { requireFacilitatorAuth } from "../../../middleware/auth.js";
import { getAgentConfigs } from "./agent-configs.js";
import { runBillingMaintenance } from "../../../lib/billing/billing-maintenance.js";
import { runMaintenanceAll } from "./billing-maintenance-all.js";
import { resolvePlan } from "./catalog-resolve-plan.js";
import { syncSubscription } from "./companies-sync-subscription.js";
import { createPreviewToken } from "./preview-token.js";

async function runMaintenance(c: Context) {
  return c.json(await runBillingMaintenance({ teamId: c.get("apiKeyTeamId") ?? (c.get("team") as any)?.teamId ?? "", now: new Date() }));
}

export const internalRoutes = new Hono()
  .get("/agent/configs", requireFacilitatorAuth(), getAgentConfigs)
  .post("/billing/maintenance", requireFacilitatorAuth(), runMaintenance)
  .post("/billing/maintenance/all", requireFacilitatorAuth(), runMaintenanceAll)
  .get("/catalog/resolve-plan", requireFacilitatorAuth(), resolvePlan)
  .patch("/companies/sync-subscription", requireFacilitatorAuth(), syncSubscription)
  // SECURITY: this route previously had no guard, unlike every sibling above.
  // It mints a short-lived embed access token, so leaving it anonymous made the
  // surrounding facilitator-only surface trivially bypassable.
  .post("/preview-token", requireFacilitatorAuth(), createPreviewToken);
