import * as Sentry from "@sentry/node";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { logger } from "./utils/logger.js";
import { PORT } from "./config.js";

// ── Load environment ─────────────────────────────────────────────────────────
const ENV_PATHS = [
  path.resolve(process.cwd(), ".env.local"),
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "apps/arcen-backend/.env.local"),
  path.resolve(process.cwd(), "apps/arcen-backend/.env"),
];

for (const envPath of ENV_PATHS) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false });
  }
}

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
}, (info) => {
  logger.info(`ArcenPay Backend API running on port ${info.port}`, {
    env: process.env.NODE_ENV ?? "development",
  });
});
