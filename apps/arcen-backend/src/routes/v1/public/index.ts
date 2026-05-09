import { Hono } from "hono";
import { getCheckout, updateCheckout } from "./checkout.js";
import { confirmCheckout } from "./checkout-confirm.js";
import { createPaymentLinkSession } from "./payment-link-session.js";
import { GET as getZeroDevConfig, OPTIONS as zeroDevOptions } from "./zerodev-config.js";

export const publicRoutes = new Hono()
  .get("/checkout/:sessionId", getCheckout)
  .patch("/checkout/:sessionId", updateCheckout)
  .post("/checkout/:sessionId/confirm", confirmCheckout)
  .post("/payment-links/:slug/session", createPaymentLinkSession)
  .get("/zerodev-config", getZeroDevConfig)
  .options("/zerodev-config", zeroDevOptions);
