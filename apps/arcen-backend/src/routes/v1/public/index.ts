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
import { enforceRateLimit } from "../../../lib/auth/rate-limit.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const publicRoutes = new Hono()
  // Every public route is unauthenticated, so it is the primary bot target.
  // Ceilings are deliberately generous: legitimate traffic includes the payment
  // page, the agent SDK, and first-party server-side proxies (which share an
  // egress IP). They exist to stop runaway floods, not to shape normal usage.
  // Requests with no trusted client IP (internal/co-located) are exempt.
  .use("*", async (c, next) => {
    const isWrite = !SAFE_METHODS.has(c.req.method.toUpperCase());
    const limited = await enforceRateLimit(c, {
      bucket: isWrite ? "public-write" : "public-read",
      limit: isWrite ? 60 : 600,
      windowMs: 60_000,
    });
    if (limited) return limited;
    return next();
  })
  .get("/checkout/:sessionId", getCheckout)
  .patch("/checkout/:sessionId", updateCheckout)
  .post("/checkout/:sessionId/confirm", confirmCheckout)
  .get("/payment-links/:slug", getPublicPaymentLinkSpec)
  .get("/payment-links/:slug/spec", getPublicPaymentLinkSpec)
  .post("/payment-links/:slug/session", createPaymentLinkSession)
  .get("/smart-account-config", getSmartAccountConfig)
  .options("/smart-account-config", smartAccountOptions)
  .route("/escrow", publicEscrowRoutes);
