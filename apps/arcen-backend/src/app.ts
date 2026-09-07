import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";
import {
  resolveCorsOrigin,
  ALLOWED_METHODS,
  ALLOWED_HEADERS,
  EXPOSE_HEADERS,
} from "./middleware/cors.js";
import { appRouter } from "./routes/index.js";

export function createApp() {
  const app = new Hono();

  // ── Global middleware ──────────────────────────────────────────────────────
  app.use(
    "*",
    cors({
      origin: (origin) => resolveCorsOrigin(origin),
      credentials: true,
      allowMethods: [...ALLOWED_METHODS],
      allowHeaders: [...ALLOWED_HEADERS],
      exposeHeaders: [...EXPOSE_HEADERS],
      maxAge: 86400,
    }),
  );

  app.use("*", prettyJSON());

  if (process.env.NODE_ENV !== "production") {
    app.use("*", logger());
  }

  // ── Health check ───────────────────────────────────────────────────────────
  app.get("/health", (c) =>
    c.json({ status: "ok", timestamp: new Date().toISOString() }),
  );

  // ── Mount all routes under /api/v1 ─────────────────────────────────────────
  app.route("/api/v1", appRouter);

  // ── 404 fallback ───────────────────────────────────────────────────────────
  app.notFound((c) =>
    c.json({ ok: false, error: "Not Found", code: "NOT_FOUND" }, 404),
  );

  // ── Error handler ──────────────────────────────────────────────────────────
  app.onError((err, c) => {
    const message =
      err instanceof Error ? err.message : "Internal Server Error";
    const isProd = process.env.NODE_ENV === "production";
    return c.json(
      {
        ok: false,
        error: "Internal Server Error",
        code: "INTERNAL_ERROR",
        ...(isProd ? {} : { detail: message }),
      },
      500 as any,
    );
  });

  return app;
}
