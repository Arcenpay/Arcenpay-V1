import { Hono } from "hono";
import { getCheckout, updateCheckout } from "./checkout.js";
import { confirmCheckout } from "./checkout-confirm.js";
import {
  createPaymentLinkSession,
  getPublicPaymentLinkSpec,
} from "./payment-link-session.js";
import {
  GET as getSmartAccountConfig,
  OPTIONS as smartAccountOptions,
} from "./smart-account-config.js";
import { publicEscrowRoutes } from "./escrow.js";

export const publicRoutes = new Hono()
  .get("/checkout/:sessionId", getCheckout)
  .patch("/checkout/:sessionId", updateCheckout)
  .post("/checkout/:sessionId/confirm", confirmCheckout)
  .get("/payment-links/:slug", getPublicPaymentLinkSpec)
  .get("/payment-links/:slug/spec", getPublicPaymentLinkSpec)
  .post("/payment-links/:slug/session", createPaymentLinkSession)
  .get("/smart-account-config", getSmartAccountConfig)
  .options("/smart-account-config", smartAccountOptions)
  .route("/escrow", publicEscrowRoutes);
