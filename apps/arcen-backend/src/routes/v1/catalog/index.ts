import { Hono } from "hono";
import { requirePermission } from "../../../middleware/auth.js";
import { listPlans, createPlan, updatePlan, deletePlan } from "./plans.js";
import { getPlanEntitlements, addPlanEntitlement, updatePlanEntitlement, deletePlanEntitlement } from "./plan-entitlements.js";
import { getPlanCompanies } from "./plan-companies.js";
import { getPlanCreditGrants, addPlanCreditGrant, deletePlanCreditGrant } from "./plan-credit-grants.js";
import { registerPlanOnChain } from "./plan-register-onchain.js";
import { getPlanSignNonce } from "./plan-sign-nonce.js";
import { confirmPlanOnChain } from "./plan-chain-confirm.js";
import { listAddOns, createAddOn, updateAddOn } from "./addons.js";
import { getAddOnEntitlements, addAddOnEntitlement, updateAddOnEntitlement, deleteAddOnEntitlement } from "./addon-entitlements.js";
import { getAddOnGrants } from "./addon-grants.js";
import { listCredits, createCredit, updateCredit } from "./credits.js";
import { getCreditBundles, saveCreditBundle, deleteCreditBundle } from "./credit-bundles.js";
import { getCreditPlanGrants, saveCreditPlanGrant, deleteCreditPlanGrant } from "./credit-plan-grants.js";
import { getCatalogConfig, updateCatalogConfig } from "./config.js";
import { publishCatalog } from "./publish.js";
import { recordChainSync } from "./chain-sync.js";

export const catalogRoutes = new Hono()
  .get("/plans", requirePermission("catalog:read"), listPlans)
  .post("/plans", requirePermission("catalog:write"), createPlan)
  .put("/plans", requirePermission("catalog:write"), updatePlan)
  .delete("/plans", requirePermission("catalog:write"), deletePlan)
  .get("/plans/:id/entitlements", requirePermission("catalog:read"), getPlanEntitlements)
  .post("/plans/:id/entitlements", requirePermission("catalog:write"), addPlanEntitlement)
  .put("/plans/:id/entitlements", requirePermission("catalog:write"), updatePlanEntitlement)
  .delete("/plans/:id/entitlements", requirePermission("catalog:write"), deletePlanEntitlement)
  .get("/plans/:id/companies", requirePermission("catalog:read"), getPlanCompanies)
  .get("/plans/:id/credit-grants", requirePermission("catalog:read"), getPlanCreditGrants)
  .post("/plans/:id/credit-grants", requirePermission("catalog:write"), addPlanCreditGrant)
  .delete("/plans/:id/credit-grants", requirePermission("catalog:write"), deletePlanCreditGrant)
  .post("/plans/:id/register-on-chain", requirePermission("catalog:write"), registerPlanOnChain)
  .get("/plans/:id/sign-nonce", requirePermission("catalog:read"), getPlanSignNonce)
  .post("/plans/:id/chain-confirm", requirePermission("catalog:write"), confirmPlanOnChain)
  .get("/add-ons", requirePermission("catalog:read"), listAddOns)
  .post("/add-ons", requirePermission("catalog:write"), createAddOn)
  .put("/add-ons", requirePermission("catalog:write"), updateAddOn)
  .get("/add-ons/:id/entitlements", requirePermission("catalog:read"), getAddOnEntitlements)
  .post("/add-ons/:id/entitlements", requirePermission("catalog:write"), addAddOnEntitlement)
  .put("/add-ons/:id/entitlements", requirePermission("catalog:write"), updateAddOnEntitlement)
  .delete("/add-ons/:id/entitlements", requirePermission("catalog:write"), deleteAddOnEntitlement)
  .get("/add-ons/:id/grants", requirePermission("catalog:read"), getAddOnGrants)
  .get("/credits", requirePermission("catalog:read"), listCredits)
  .post("/credits", requirePermission("catalog:write"), createCredit)
  .put("/credits", requirePermission("catalog:write"), updateCredit)
  .get("/credits/:id/bundles", requirePermission("catalog:read"), getCreditBundles)
  .post("/credits/:id/bundles", requirePermission("catalog:write"), saveCreditBundle)
  .delete("/credits/:id/bundles", requirePermission("catalog:write"), deleteCreditBundle)
  .get("/credits/:id/plan-grants", requirePermission("catalog:read"), getCreditPlanGrants)
  .post("/credits/:id/plan-grants", requirePermission("catalog:write"), saveCreditPlanGrant)
  .delete("/credits/:id/plan-grants", requirePermission("catalog:write"), deleteCreditPlanGrant)
  .get("/config", requirePermission("catalog:read"), getCatalogConfig)
  .put("/config", requirePermission("catalog:write"), updateCatalogConfig)
  .post("/publish", requirePermission("catalog:write"), publishCatalog)
  .post("/chain-sync", requirePermission("catalog:write"), recordChainSync);
