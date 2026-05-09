import { Hono } from "hono";
import { testWebhook } from "./test.js";
import { getWebhookLog } from "./log.js";
import { recordWebhookDelivery } from "./delivery.js";

export const webhooksRoutes = new Hono()
  .post("/test", testWebhook)
  .get("/log", getWebhookLog)
  .post("/delivery", recordWebhookDelivery);
