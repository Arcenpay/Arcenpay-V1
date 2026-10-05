import type { Context, Next } from "hono";
import {
  aj,
  shouldBypassGlobalProtection,
  arcjetNodeRequest,
  resolveTrustedClientIp,
} from "../lib/auth/arcjet.js";

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
 *   2. Requests carrying a key that is PROVABLY registered on this platform
 *      (valid, not revoked, not expired, hash-matched). A fake/foreign key
 *      that merely imitates sk_/rk_/pk_ does NOT bypass — it falls through to
 *      bot/shield, so attackers can't dodge protection by guessing a prefix.
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

  // The hosted MCP surface is consumed by machine clients — OpenAI's plugin
  // verifier, ChatGPT/Codex connectors, and other MCP hosts — which look like
  // bots to Arcjet. Bot/shield blocking them returns a 429 and breaks domain
  // verification and the OAuth/metadata discovery fetches. These routes never
  // serve user HTML and enforce their own auth (OAuth 2.1 or an API key), so
  // they are exempt from edge bot/shield protection.
  if (
    pathname === "/mcp" ||
    pathname.startsWith("/mcp/") ||
    pathname === "/oauth" ||
    pathname.startsWith("/oauth/") ||
    pathname === "/.well-known" ||
    pathname.startsWith("/.well-known/")
  ) {
    return next();
  }

  // Internal/machine traffic (Railway health checks, in-container calls from the
  // co-located facilitator) arrives with no proxy-appended client IP. Arcjet
  // cannot fingerprint it, so evaluating shield/bot here only produces
  // "Failed to build fingerprint" noise on every poll and burns quota. Such a
  // request never came from the public internet — Railway's edge always sets
  // X-Forwarded-For for external traffic — so it is safe to pass through.
  if (!resolveTrustedClientIp(c.req.raw.headers)) {
    return next();
  }

  // First-party API consumers are exempt from bot/shield edge protection —
  // but ONLY when the key is registered on this platform (fail-closed: a fake
  // or foreign sk_/rk_/pk_ key does NOT bypass and still gets bot/shield).
  if (await shouldBypassGlobalProtection(c.req.raw)) {
    return next();
  }

  // SECURITY vs AVAILABILITY: if Arcjet itself fails (network blip, quota,
  // malformed rule input such as a missing User-Agent), we must NOT turn that
  // into a 500 for a legitimate caller. An exception here previously propagated
  // to Hono's onError and failed every request — which is exactly the kind of
  // thing that makes the docs playground and a user's first curl appear broken.
  // We therefore fail OPEN on infrastructure errors and log loudly, matching the
  // facilitator's existing Arcjet behaviour, while still failing CLOSED on a real
  // deny decision.
  let decision: Awaited<ReturnType<typeof aj.protect>>;
  try {
    decision = await aj.protect(arcjetNodeRequest(c.req.raw) as any);
  } catch (err) {
    console.error(
      "[arcjet] Global protection failed to evaluate; allowing request. " +
        "Investigate immediately — protection was skipped for this request.",
      err,
    );
    return next();
  }

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
