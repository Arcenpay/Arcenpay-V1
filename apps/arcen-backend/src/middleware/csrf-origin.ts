/**
 * CSRF guard for cookie-authenticated, state-changing requests.
 *
 * WHY THIS EXISTS
 * ---------------
 * The dashboard session lives in a cookie. CORS restricts which origins may
 * *read* a response, but it does NOT prevent a cross-site page from *sending*
 * a request that carries the user's cookie — the browser attaches cookies to
 * cross-site form posts and to `credentials: "include"` fetches regardless of
 * CORS. A cookie-authenticated POST therefore has to be validated against the
 * request's provenance, not just its `Origin` reflection.
 *
 * RULES (applied only to unsafe methods with a session cookie present)
 * -------------------------------------------------------------------
 *   1. `Sec-Fetch-Site: cross-site`                     → REJECT (browser-tagged).
 *   2. `Sec-Fetch-Site: same-origin | none`             → ALLOW.
 *   3. No Sec-Fetch-Site, but `Origin` present          → must be a trusted origin.
 *   4. No Sec-Fetch-Site, but `Referer` present         → its origin must be trusted.
 *   5. Non-browser client (no Origin/Referer/Fetch-Site) but a session cookie
 *      is attached                                      → REJECT. A well-behaved
 *      non-browser client uses a Bearer API key, not a browser session cookie.
 *
 * Requests authenticated with an `Authorization`/`X-API-Key` header are skipped
 * entirely — header-based credentials cannot be attached by a hostile page
 * (the browser would have to be told the key), so they are not CSRF-able.
 * Facilitator-to-backend calls use a Bearer token too, so internal traffic is
 * unaffected.
 */

import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { resolveCorsOrigin } from "./cors.js";
import { AUTH_COOKIE_NAME } from "../lib/auth/auth-constants.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function ownOrigin(c: Context): string {
  try {
    return new URL(c.req.url).origin;
  } catch {
    return "";
  }
}

function isTrustedProvenance(origin: string | null, selfOrigin: string): boolean {
  if (!origin) return false;
  if (selfOrigin && origin === selfOrigin) return true;
  return resolveCorsOrigin(origin) !== null;
}

export async function csrfOriginGuard(c: Context, next: Next): Promise<Response | void> {
  if (SAFE_METHODS.has(c.req.method.toUpperCase())) {
    return next();
  }

  // Header-based credentials are immune to CSRF — a hostile page cannot set
  // them. Only cookie-authenticated requests need provenance validation.
  const hasHeaderCredential = Boolean(
    c.req.header("authorization") ?? c.req.header("x-api-key"),
  );
  if (hasHeaderCredential) {
    return next();
  }

  const sessionCookie = getCookie(c, AUTH_COOKIE_NAME);
  if (!sessionCookie) {
    // Nothing cookie-authenticated to forge. (Routes that require a session
    // will 401 on their own; unauthenticated endpoints are unaffected.)
    return next();
  }

  const selfOrigin = ownOrigin(c);
  const fetchSite = c.req.header("sec-fetch-site")?.trim().toLowerCase();

  if (fetchSite === "cross-site") {
    return c.json(
      {
        ok: false,
        error: "Cross-site request rejected",
        code: "CSRF_ORIGIN_MISMATCH",
      },
      403 as any,
    );
  }

  if (fetchSite === "same-origin" || fetchSite === "none" || fetchSite === "same-site") {
    return next();
  }

  const origin = c.req.header("origin");
  if (origin) {
    if (isTrustedProvenance(origin, selfOrigin)) {
      return next();
    }
    return c.json(
      {
        ok: false,
        error: "Request origin is not allowed",
        code: "CSRF_ORIGIN_MISMATCH",
      },
      403 as any,
    );
  }

  const referer = c.req.header("referer");
  if (referer) {
    let refererOrigin: string | null = null;
    try {
      refererOrigin = new URL(referer).origin;
    } catch {
      refererOrigin = null;
    }
    if (refererOrigin && isTrustedProvenance(refererOrigin, selfOrigin)) {
      return next();
    }
    return c.json(
      {
        ok: false,
        error: "Request referer is not allowed",
        code: "CSRF_ORIGIN_MISMATCH",
      },
      403 as any,
    );
  }

  // A cookie-authenticated unsafe request with zero provenance metadata is not
  // something a real browser session produces. Fail closed.
  return c.json(
    {
      ok: false,
      error: "Missing request provenance for cookie-authenticated request",
      code: "CSRF_PROVENANCE_MISSING",
    },
    403 as any,
  );
}
