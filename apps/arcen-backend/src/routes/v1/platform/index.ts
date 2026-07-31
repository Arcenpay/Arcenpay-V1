import { Hono } from "hono";
import { getOverview } from "./overview.js";
import { getRevenueSeries } from "./revenue-series.js";
import { getSessions } from "./sessions.js";
import { getTier, postTier } from "./tier.js";
import { getTierHistory } from "./tier-history.js";
import { getSupportTickets, createSupportTicket } from "./support.js";
import { getGasBudget } from "./gas-budget.js";
import { recordGasSpend } from "./gas-spend.js";
import { postTierBootstrap } from "./tier-bootstrap.js";
import { postTierPrepare } from "./tier-prepare.js";
import { postTierConfirm } from "./tier-confirm.js";
import { getPlatformInvoices } from "./invoices.js";
import {
  getPlatformBillingStatusRoute,
  postPlatformBillingEnrollment,
  postPlatformBillingEmbed,
} from "./platform-billing-embed.js";

export const platformRoutes = new Hono()
  .get("/overview", getOverview)
  .get("/revenue-series", getRevenueSeries)
  .get("/sessions", getSessions)
  .get("/tier", getTier)
  .post("/tier", postTier)
  .post("/tier/bootstrap", postTierBootstrap)
  .post("/tier/prepare", postTierPrepare)
  .post("/tier/confirm", postTierConfirm)
  .get("/billing/status", getPlatformBillingStatusRoute)
  .post("/billing/enroll", postPlatformBillingEnrollment)
  .post("/billing/embed-token", postPlatformBillingEmbed)
  .get("/invoices", getPlatformInvoices)
  .get("/tier-history", getTierHistory)
  .get("/support", getSupportTickets)
  .post("/support", createSupportTicket)
  .get("/gas-budget", getGasBudget)
  .post("/gas-spend", recordGasSpend);
