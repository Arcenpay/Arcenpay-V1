import type { Context, Next } from "hono";
import { aj, shouldBypassGlobalProtection, arcjetNodeRequest } from "../lib/auth/arcjet.js";

/**
 * Global Arcjet protection middleware (shield + detectBot).
 *
 * This is the single place production applies BEFORE rate limiting / auth so
 * anonymous scraping and known attack payloads are blocked at the edge. It is
 * completely inert unless:
 *   - NODE_ENV === "production", AND
 *   - ARCJET_KEY is a real (non-placeholder) key.
 *
 * Two classes of traffic are ALWAYS passed through, because they are
 * legitimate first-party API consumers (see shouldBypassGlobalProtection):
 *   1. Requests originating from the docs API reference playground
 *      (https://docs.arcenpay.com) — "Try it" testing must never 429.
 *   2. Requests carrying a valid server API key (sk_live_/sk_test_/rk_live_/
 *      rk_test_) — authenticated API consumers; the per-key rate limiter in
 *      api-key-auth.ts is their real protection.
 *
 * Everything else (anonymous browsers, potential scrapers, unknown origins)
 * is fully covered by Arcjet shield + detectBot exactly as before.
 */
export async function arcjetGlobalProtect(c: Context, next: Next) {
  // Production-only + real key. Outside production this is a no-op (Arcjet
  // rules are DRY_RUN and returning here avoids an unnecessary round-trip).
  if (
    process.env.NODE_ENV !== "production" ||
    !process.env.ARCJET_KEY ||
    process.env.ARCJET_KEY.trim() === "" ||
    process.env.ARCJET_KEY.includes("placeholder")
  ) {
    return next();
  }

  // Never block the health check.
  const pathname = new URL(c.req.url).pathname;
  if (pathname === "/health") {
    return next();
  }

  // First-party API consumers are exempt from bot/shield edge protection.
  if (shouldBypassGlobalProtection(c.req.raw)) {
    return next();
  }

  const decision = await aj.protect(
    arcjetNodeRequest(c.req.raw) as any,
  );
  if (decision.isDenied()) {
    // Use the Arcjet reason type to give a helpful, non-misleading error.
    const isBotBlock = decision.results.some(
      (r) => (r.reason as { type?: string })?.type === "BOT",
    );
    if (isBotBlock) {
      return c.json(
        {
          ok: false,
          error:
            "Request blocked. Automated/headless clients are not allowed unless they present a valid ArcenPay API key.",
          code: "BOT_BLOCKED",
        },
        429 as any,
      );
    }
    return c.json(
      { ok: false, error: "Rate limit exceeded", code: "RATE_LIMITED" },
      429 as any,
    );
  }

  return next();
}
