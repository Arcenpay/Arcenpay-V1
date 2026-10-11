import type { Context, Next } from "hono";
import { enforceRateLimit } from "../lib/auth/rate-limit.js";
import { shouldBypassGlobalProtection } from "../lib/auth/arcjet.js";

/**
 * Per-IP rate-limit middleware wrapper for endpoints reachable WITHOUT a
 * first-class credential (embed tokens in a query param, anonymous public
 * routes).
 *
 * KEY-VERIFIED CALLERS ARE EXEMPT: traffic authenticated with a GENUINE
 * `sk_`/`rk_`/`pk_` key is governed ONLY by the per-key limit (see
 * `requireApiKey` and the documented 5,000/60s ceiling). Applying an IP limit on
 * top would (a) contradict the published rate-limit contract and (b) throttle
 * legitimate server SDKs that legitimately share a NAT egress IP.
 *
 * SECURITY: "genuine" means PROVABLY REGISTERED on this platform (valid, not
 * revoked, not expired — verified against the DB by hash), the same test
 * `arcjetGlobalProtect` uses. A key that merely imitates the `sk_`/`pk_`/`rk_`
 * prefix must NOT skip the limit: a shape-only check let `x-api-key: sk_fake`
 * bounce past this limiter (while the route ignored that header and served the
 * anonymous path), so any attacker could get unlimited unauthenticated
 * requests. Fail-closed: if the credential can't be verified, the IP limit
 * applies.
 */
export function ipRateLimit(options: {
  bucket: string;
  limit: number;
  windowMs: number;
}) {
  return async (c: Context, next: Next) => {
    if (await shouldBypassGlobalProtection(c.req.raw)) {
      return next();
    }

    const limited = await enforceRateLimit(c, options);
    if (limited) return limited;
    return next();
  };
}
