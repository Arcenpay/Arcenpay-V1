import "./load-env.js";
import * as Sentry from "@sentry/node";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { logger } from "./utils/logger.js";
import { PORT } from "./config.js";

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? "development",
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
  });
}

// ── Start server ─────────────────────────────────────────────────────────────
const app = createApp();

serve({
  fetch: app.fetch,
  port: PORT,
  hostname: "0.0.0.0",
}, (info) => {
  logger.info(`ArcenPay Backend API running on port ${info.port}`, {
    env: process.env.NODE_ENV ?? "development",
  });
});
