import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";
import { appRouter } from "./routes/index.js";

export function createApp() {
  const app = new Hono();

  // ── Global middleware ──────────────────────────────────────────────────────
  app.use("*", cors({
    origin: (origin) => {
      const allowed = [
        process.env.DASHBOARD_URL || "http://localhost:3000",
        "http://localhost:3000",
        "http://localhost:3001",
      ].filter(Boolean) as string[];
      return allowed.includes(origin ?? "") ? origin : allowed[0];
    },
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "x-api-key", "x-embed-token"],
    exposeHeaders: ["x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset"],
  }));

  app.use("*", prettyJSON());

  if (process.env.NODE_ENV !== "production") {
    app.use("*", logger());
  }

  // ── Health check ───────────────────────────────────────────────────────────
  app.get("/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

  // ── Mount all routes under /api/v1 ─────────────────────────────────────────
  app.route("/api/v1", appRouter);

  // ── 404 fallback ───────────────────────────────────────────────────────────
  app.notFound((c) => c.json({ ok: false, error: "Not Found", code: "NOT_FOUND" }, 404));

  // ── Error handler ──────────────────────────────────────────────────────────
  app.onError((err, c) => {
    const message = err instanceof Error ? err.message : "Internal Server Error";
    const isProd = process.env.NODE_ENV === "production";
    return c.json({
      ok: false,
      error: "Internal Server Error",
      code: "INTERNAL_ERROR",
      ...(isProd ? {} : { detail: message }),
    }, 500 as any);
  });

  return app;
}
