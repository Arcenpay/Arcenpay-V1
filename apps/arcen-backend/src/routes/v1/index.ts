import { Hono } from "hono";
import { authRoutes } from "./auth/index.js";
import { catalogRoutes } from "./catalog/index.js";
import { billingRoutes } from "./billing/index.js";
import { invoicesRoutes } from "./invoices/index.js";
import { providerRoutes } from "./provider/index.js";
import { teamRoutes } from "./team/index.js";
import { internalRoutes } from "./internal/index.js";
import { platformRoutes } from "./platform/index.js";
import { opsRoutes } from "./ops/index.js";
import { webhooksRoutes } from "./webhooks/index.js";
import { entitlementsRoutes } from "./entitlements/index.js";
import { proofsRoutes } from "./proofs/index.js";
import { subscriberRoutes } from "./subscriber/index.js";
import { templatesRoutes } from "./templates/index.js";
import { auditRoutes } from "./audit/index.js";
import { environmentRoutes } from "./environment/index.js";
import { publicRoutes } from "./public/index.js";
import { companiesRoutes } from "./companies/index.js";
import { mandateRoutes } from "./mandates.js";
import { adminActivationKeysRouter } from "./admin/activation-keys.js";
import { adminAnalyticsRouter } from "./admin/analytics.js";
import { adminUsersRouter } from "./admin/users.js";
import { activationRouter } from "./activation.js";

// ── SDK flat files (Next.js-style exports: GET, POST, OPTIONS) ──────────────
import { GET as getCheck, OPTIONS as checkOptions } from "./check.js";
import { GET as getEntitlements, OPTIONS as entsOptions } from "./entitlements.js";
import { GET as listUsers, POST as createUser } from "./users.js";
import { GET as listEvents, POST as trackEvent, OPTIONS as eventsOptions } from "./events.js";
import { GET as listFeatureFlags, POST as createFeatureFlag } from "./feature-flags.js";
import { GET as listFlagRules, POST as createFlagRule, PUT as updateFlagRule } from "./feature-flag-rules.js";
import { GET as listFlagOverrides, POST as createFlagOverride, DELETE as deleteFlagOverride } from "./feature-flag-overrides.js";
import { GET as listFeatures, POST as createFeature } from "./features.js";
import { PUT as updateFeature, DELETE as deleteFeature } from "./feature-by-id.js";
import { GET as checkFlag } from "./flags-check.js";
import { GET as listCheckoutSessions, POST as createCheckoutSession } from "./checkout-sessions.js";
import { GET as getCheckoutSessionById } from "./checkout-session-by-id.js";
import { GET as listPaymentLinks, POST as createPaymentLink } from "./payment-links.js";
import { GET as getPaymentLink, PATCH as updatePaymentLink } from "./payment-link-by-id.js";
import { GET as listComponents, POST as createComponent } from "./components.js";
import { PATCH as updateComponent, DELETE as deleteComponent } from "./component-by-id.js";
import { GET as renderComponent, OPTIONS as renderOptions } from "./component-render.js";
import { GET as validateCoupon, OPTIONS as couponOptions } from "./coupons-validate.js";
import { POST as activateSubscription, OPTIONS as subOptions } from "./subscriptions-activate.js";
import { POST as consumeUsage, OPTIONS as usageOptions } from "./usage-consume.js";
import { POST as createAccessToken, OPTIONS as tokenOptions } from "./access-tokens.js";
import { POST as companyPlanChange, OPTIONS as companyPlanOptions } from "./company-plan.js";
import { POST as companyPlanPreview, OPTIONS as companyPlanPreviewOptions } from "./company-plan-preview.js";
import { POST as companyUnsubscribe, OPTIONS as companyUnsubscribeOptions } from "./company-unsubscribe.js";
import { POST as companyResume, OPTIONS as companyResumeOptions } from "./company-resume.js";
import { GET as listApiKeys, POST as createApiKeySdk, DELETE as revokeApiKey } from "./api-keys.js";
import { createTempToken } from "./api-keys.js";
import { GET as getZkTlsProofs, POST as createZkTlsProof } from "./proofs-zktls.js";
import { GET as getAgentPermissions, PUT as updateAgentPermissions } from "./agent-permissions.js";
import { recordAgentFunding } from "./agent-permissions.js";
import { GET as getAgentDispatch, POST as createAgentDispatch } from "./agent-dispatch.js";
import { POST as testAgentDispatch } from "./agent-dispatch-test.js";

// ── Main V1 Router ──────────────────────────────────────────────────────────

export const v1Router = new Hono()
  // ── Core routes (sub-routers) ────────────────────────────────────────────
  .route("/auth", authRoutes)
  .route("/catalog", catalogRoutes)
  .route("/billing", billingRoutes)
  .route("/invoices", invoicesRoutes)
  .route("/companies", companiesRoutes)
  .route("/provider", providerRoutes)
  .route("/team", teamRoutes)
  .route("/internal", internalRoutes)
  .route("/platform", platformRoutes)
  .route("/ops", opsRoutes)
  .route("/webhooks", webhooksRoutes)
  .route("/proofs", proofsRoutes)
  .route("/subscriber", subscriberRoutes)
  .route("/templates", templatesRoutes)
  .route("/audit-log", auditRoutes)
  .route("/environments", environmentRoutes)
  .route("/environment", environmentRoutes)
  .route("/public", publicRoutes)
  .route("/mandates", mandateRoutes)
  .route("/admin/analytics", adminAnalyticsRouter)
  .route("/admin/activation-keys", adminActivationKeysRouter)
  .route("/admin/users", adminUsersRouter)
  .route("/activation", activationRouter)

  // ── SDK flat routes ──────────────────────────────────────────────────────
  .get("/check", getCheck)
  .options("/check", checkOptions)
  .get("/entitlements", getEntitlements)
  .options("/entitlements", entsOptions)
  .route("/entitlements", entitlementsRoutes)
  .get("/users", listUsers)
  .post("/users", createUser)
  .get("/events", listEvents)
  .post("/events", trackEvent)
  .options("/events", eventsOptions)
  .get("/feature-flags", listFeatureFlags)
  .post("/feature-flags", createFeatureFlag)
  .get("/feature-flags/:id/rules", listFlagRules)
  .post("/feature-flags/:id/rules", createFlagRule)
  .put("/feature-flags/:id/rules", updateFlagRule)
  .get("/feature-flags/:id/overrides", listFlagOverrides)
  .post("/feature-flags/:id/overrides", createFlagOverride)
  .delete("/feature-flags/:id/overrides", deleteFlagOverride)
  .get("/features", listFeatures)
  .post("/features", createFeature)
  .put("/features/:id", updateFeature)
  .delete("/features/:id", deleteFeature)
  .get("/flags/check", checkFlag)
  .get("/checkout-sessions", listCheckoutSessions)
  .post("/checkout-sessions", createCheckoutSession)
  .get("/checkout-sessions/:id", getCheckoutSessionById)
  .get("/payment-links", listPaymentLinks)
  .post("/payment-links", createPaymentLink)
  .get("/payment-links/:id", getPaymentLink)
  .patch("/payment-links/:id", updatePaymentLink)
  .get("/components", listComponents)
  .post("/components", createComponent)
  .patch("/components/:id", updateComponent)
  .delete("/components/:id", deleteComponent)
  .get("/components/:id/render", renderComponent)
  .options("/components/:id/render", renderOptions)
  .get("/coupons/validate", validateCoupon)
  .options("/coupons/validate", couponOptions)
  .post("/subscriptions/activate", activateSubscription)
  .options("/subscriptions/activate", subOptions)
  .post("/companies/plan", companyPlanChange)
  .options("/companies/plan", companyPlanOptions)
  .post("/companies/plan/preview", companyPlanPreview)
  .options("/companies/plan/preview", companyPlanPreviewOptions)
  .post("/companies/unsubscribe", companyUnsubscribe)
  .options("/companies/unsubscribe", companyUnsubscribeOptions)
  .post("/companies/resume", companyResume)
  .options("/companies/resume", companyResumeOptions)
  .post("/usage/consume", consumeUsage)
  .options("/usage/consume", usageOptions)
  .post("/access-tokens", createAccessToken)
  .options("/access-tokens", tokenOptions)
  .get("/api-keys", listApiKeys)
  .post("/api-keys", createApiKeySdk)
  .delete("/api-keys", revokeApiKey)
  .post("/api-keys/tokens", createTempToken)
  .get("/proofs/zktls", getZkTlsProofs)
  .post("/proofs/zktls", createZkTlsProof)
  .get("/agent/permissions", getAgentPermissions)
  .put("/agent/permissions", updateAgentPermissions)
  .get("/agent/dispatch", getAgentDispatch)
  .post("/agent/dispatch", createAgentDispatch)
  .post("/agent/dispatch/test", testAgentDispatch)
  .post("/agent/fund", recordAgentFunding);
