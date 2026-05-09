import { Hono } from "hono";
import { getProfile, putProfile } from "./profile.js";
import { getApiKeys, createApiKey, revokeApiKeys } from "./api-keys.js";
import { revokeApiKeyById } from "./api-key-by-id.js";
import { getWebhookConfig, putWebhookConfig } from "./webhooks.js";
import { rotateWebhookSecret } from "./webhook-secret.js";
import { getNotifications, putNotifications } from "./notifications.js";

export const providerRoutes = new Hono()
  .get("/profile", getProfile)
  .put("/profile", putProfile)
  .get("/api-keys", getApiKeys)
  .post("/api-keys", createApiKey)
  .delete("/api-keys", revokeApiKeys)
  .delete("/api-keys/:id", revokeApiKeyById)
  .get("/webhooks", getWebhookConfig)
  .put("/webhooks", putWebhookConfig)
  .post("/webhooks/secret", rotateWebhookSecret)
  .get("/notifications", getNotifications)
  .put("/notifications", putNotifications);
