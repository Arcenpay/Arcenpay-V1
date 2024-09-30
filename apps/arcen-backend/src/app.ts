import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import {
  resolveCorsOrigin,
  ALLOWED_METHODS,
  ALLOWED_HEADERS,
  EXPOSE_HEADERS,
} from "./middleware/cors.js";
import { csrfOriginGuard } from "./middleware/csrf-origin.js";
import { appRouter } from "./routes/index.js";
import { arcjetGlobalProtect } from "./middleware/arcjet-global.js";
import { MCP_SERVER_ENABLED } from "./config.js";
import { handleMcpRequest } from "./mcp/server.js";
import { mcpWellKnownRoutes } from "./mcp/well-known.js";
import { createOAuthRoutes } from "./mcp/oauth.js";

/**
 * Maximum accepted request body.
 *
 * Billing/checkout payloads are all well under this; a large ceiling here only
 * serves to let an attacker spend our memory and CPU parsing megabytes of JSON.
 */
const MAX_REQUEST_BODY_BYTES = 1 * 1024 * 1024; // 1 MiB

export function createApp() {
  const app = new Hono();

  // ── Security headers ───────────────────────────────────────────────────────
  // This is a JSON API: it is never framed, never needs a referrer, and its
  // responses must never be cached by an intermediary (they carry tenant data).
  app.use(
    "*",
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
      xFrameOptions: "DENY",
      xContentTypeOptions: "nosniff",
      referrerPolicy: "no-referrer",
      strictTransportSecurity: "max-age=63072000; includeSubDomains",
      // This API is consumed cross-origin BY DESIGN: the React SDK embeds in
      // provider websites and the Mintlify playground runs on docs.arcenpay.com.
      // `same-site` would block those legitimate readers, so CORP is
      // deliberately `cross-origin` — access control is enforced by CORS plus
      // the credential check, not by CORP.
      crossOriginResourcePolicy: "cross-origin",
      crossOriginOpenerPolicy: "same-origin",
      xDnsPrefetchControl: "off",
      xPermittedCrossDomainPolicies: "none",
    }),
  );

  // ── Request body size limit ────────────────────────────────────────────────
  app.use(
    "*",
    bodyLimit({
      maxSize: MAX_REQUEST_BODY_BYTES,
      onError: (c) =>
        c.json(
          { ok: false, error: "Request body too large", code: "PAYLOAD_TOO_LARGE" },
          413 as any,
        ),
    }),
  );

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

  // ── CSRF guard for cookie-authenticated mutations ──────────────────────────
  // CORS decides who may READ a response; it does not stop a hostile page from
  // SENDING a cookie-bearing request. This enforces request provenance for
  // unsafe methods that rely on the session cookie.
  app.use("*", csrfOriginGuard);

  app.use("*", prettyJSON());

  // Global Arcjet edge protection (shield + detectBot). No-op outside
  // production, and bypassed only for keys provably registered on this platform.
  app.use("*", arcjetGlobalProtect);

  if (process.env.NODE_ENV !== "production") {
    app.use("*", logger());
  }

  // ── Health check ───────────────────────────────────────────────────────────
  app.get("/health", (c) =>
    c.json({ status: "ok", timestamp: new Date().toISOString() }),
  );

  // ── Mount all routes under /api/v1 ─────────────────────────────────────────
  app.route("/api/v1", appRouter);

  // ── Hosted MCP server (opt-in) ─────────────────────────────────────────────
  // Read-only tool tier over MCP Streamable HTTP. Off unless MCP_SERVER_ENABLED
  // is "true", so existing deployments are unaffected. Auth is an ArcenPay
  // SECRET/RESTRICTED API key (Bearer).
  if (MCP_SERVER_ENABLED) {
    app.route("/.well-known", mcpWellKnownRoutes);
    app.route("/oauth", createOAuthRoutes());
    app.all("/mcp", (c) => handleMcpRequest(c.req.raw));
  }

  // ── 404 fallback ───────────────────────────────────────────────────────────
  app.notFound((c) =>
    c.json({ ok: false, error: "Not Found", code: "NOT_FOUND" }, 404),
  );

  // ── Error handler ──────────────────────────────────────────────────────────
  app.onError((err, c) => {
    const message =
      err instanceof Error ? err.message : "Internal Server Error";
    const isProd = process.env.NODE_ENV === "production";
    // Never leak internal messages, stack traces, or driver errors in
    // production responses — only a correlation-friendly generic envelope.
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
