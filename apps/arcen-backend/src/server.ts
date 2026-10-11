import "./load-env.js";
import * as Sentry from "@sentry/node";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { logger } from "./utils/logger.js";
import { PORT } from "./config.js";
import { verifyDatabaseConnection, closeDatabase } from "./db.js";

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? "development",
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
  });
}

// ── Start server ─────────────────────────────────────────────────────────────
const app = createApp();

const server = serve({
  fetch: app.fetch,
  port: PORT,
  hostname: "0.0.0.0",
}, (info) => {
  logger.info(`ArcenPay Backend API running on port ${info.port}`, {
    env: process.env.NODE_ENV ?? "development",
  });
});

// ── Graceful shutdown ────────────────────────────────────────────────────────
// Stop accepting connections and close the Postgres pool before exiting.
// Managed plans (free tiers in particular) cap `max_connections`, so a redeploy
// that leaves the previous container's pool open is a direct cause of
// "too many clients" on the next boot.
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`[server] ${signal} received — closing server and database pool`);
  try {
    server.close();
  } catch {
    // already closed
  }
  await closeDatabase().catch(() => {});
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

// Boot-time database probe. Deliberately AFTER the port is bound: a dead
// database must not delay startup (that would trip the platform health check and
// start a restart loop), but it must be impossible to miss in the logs rather
// than surfacing as a flood of unexplained 500s.
void verifyDatabaseConnection().then((ok) => {
  if (ok) {
    logger.info("[db] Postgres connection verified");
  } else {
    logger.error(
      "[db] Postgres unreachable at boot — DB-backed requests will 500 until fixed",
    );
  }
});
