import arcjet, {
  shield,
  detectBot,
  fixedWindow,
  sensitiveInfo,
  tokenBucket,
} from "@arcjet/node";

const hasArcjetKey = Boolean(
  process.env.ARCJET_KEY &&
  process.env.ARCJET_KEY.trim() !== "" &&
  !process.env.ARCJET_KEY.includes("placeholder"),
);

const isProduction = process.env.NODE_ENV === "production";
const isLive = isProduction && hasArcjetKey;

// Ensure Arcjet knows whether we're in dev (silences the
// "Set ARCJET_ENV to development" warning and enables dev log behavior).
process.env.ARCJET_ENV ??= isProduction ? "production" : "development";

/**
 * Builds an Arcjet-Node-compatible request with a client IP so fingerprinting
 * via the `ip.src` characteristic NEVER fails.
 *
 * Hono's `c.req.raw` is a Web `Request` — it has no Node `socket.remoteAddress`.
 * When Arcjet needs `ip.src` (rate limits, shield, bot detection) it extracts
 * the IP from either the socket or X-Forwarded-For. If both are absent it
 * throws "Failed to build fingerprint … value was empty", which would 500 the
 * request. We defensively provide the client IP from the standard forwarded
 * headers (or the loopback in local dev) so fingerprinting always succeeds.
 */
export function arcjetNodeRequest(
  request: Request | Record<string, any>,
): Record<string, any> {
  const headers =
    request instanceof Request
      ? request.headers
      : (request as any).headers;
  const get =
    typeof headers?.get === "function" ? headers.get.bind(headers) : null;

  let clientIp: string | undefined;
  if (get) {
    const forwarded = get("x-forwarded-for");
    clientIp = forwarded
      ? forwarded.split(",")[0]?.trim() || undefined
      : undefined;
    clientIp ??= get("x-real-ip") ?? undefined;
    clientIp ??= get("cf-connecting-ip") ?? undefined;
  } else {
    clientIp =
      (request as any).ip ??
      (request as any).xForwardedFor ??
      (request as any).remoteAddress ??
      undefined;
  }

  // Dev loopback fallback keeps Arcjet working in environments without a
  // proxy (Docker/CI/localhost). In production a missing IP would otherwise
  // be an infra misconfiguration — but we still never 500 requests for it.
  clientIp ??= "127.0.0.1";

  const method = get
    ? undefined // tolerate standard Request (method read by Arcjet internally)
    : (request as any).method ?? undefined;
  const url = get ? undefined : (request as any).url ?? undefined;

  return {
    ...(request instanceof Request
      ? request
      : request),
    headers: get
      ? Object.fromEntries(headers.entries())
      : (headers ?? {}),
    ...(method ? { method } : {}),
    ...(url ? { url } : {}),
    socket: { remoteAddress: clientIp },
  };
}

/**
 * The Mintlify API reference playground (docs.arcenpay.com) is a FIRST-PARTY
 * testing surface: users hit "Try it", and the request is a curl-like call
 * from their browser with an `Origin`/`Referer` of docs.arcenpay.com.
 *
 * These requests are legitimate platform self-testing and must NEVER be
 * rejected by Arcjet (bot detection OR per-key rate limits) — otherwise the
 * "try it" experience breaks and users blame their key. Everything else keeps
 * the exact same protection.
 */
export const DOCS_ALLOWED_ORIGINS = [
  "https://docs.arcenpay.com",
  "http://localhost:3003",
  "http://localhost:3003/",
] as const;

/** Normalize an Origin/Referer to its bare host+scheme origin. */
function normalizeOriginHeader(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    return new URL(value.trim()).origin;
  } catch {
    return null;
  }
}

/**
 * Returns true when the request originated from the ArcenPay docs API
 * playground (`https://docs.arcenpay.com`).
 */
export function isDocsApiOrigin(
  request: Request | Record<string, any>,
): boolean {
  const headers =
    request instanceof Request
      ? request.headers
      : (request as any).headers;
  const get = typeof headers?.get === "function" ? headers.get.bind(headers) : null;
  const origin = get
    ? normalizeOriginHeader(get("origin") ?? get("referer"))
    : normalizeOriginHeader((request as any).origin ?? (request as any).referer);
  return origin
    ? DOCS_ALLOWED_ORIGINS.some((allowed) => normalizeOriginHeader(allowed) === origin)
    : false;
}

/**
 * Returns true when this request should bypass GLOBAL bot-detection /
 * shield protection entirely.
 *
 * Production deployments that apply `aj`/`detectBot` in front of the request
 * pipeline MUST short-circuit with this check BEFORE calling `aj.protect()`:
 *
 *   const bypass = shouldBypassGlobalProtection(request);
 *   if (!bypass) {
 *     const decision = await aj.protect(request);
 *     if (decision.isDenied()) return denyResponse(decision);
 *   }
 *
 * Bypassed traffic:
 *  - the docs API reference playground (docs.arcenpay.com) — "Try it" testing,
 *  - ANY request carrying a platform credential (`sk_`/`rk_`/`pk_`).
 *
 * Authenticated traffic is trusted API consumption; throttling it would block
 * legitimate high-volume integrations. Anonymous requests (no key, unknown
 * origin) still get full shield + bot protection.
 */
export function shouldBypassGlobalProtection(
  request: Request | Record<string, any>,
): boolean {
  if (isDocsApiOrigin(request)) return true;
  const headers =
    request instanceof Request
      ? request.headers
      : (request as any).headers;
  const get = typeof headers?.get === "function" ? headers.get.bind(headers) : null;
  const auth: string | null | undefined = get
    ? get("authorization") ?? get("x-api-key")
    : (request as any).authorization;
  if (!auth) return false;
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : auth.trim();
  return (
    token.startsWith("sk_live_") ||
    token.startsWith("sk_test_") ||
    token.startsWith("rk_live_") ||
    token.startsWith("rk_test_") ||
    token.startsWith("pk_live_") ||
    token.startsWith("pk_test_")
  );
}

const aj = arcjet({
  key: process.env.ARCJET_KEY || "ajkey_placeholder",
  characteristics: ["ip.src"],
  rules: isLive
    ? [
        shield({ mode: "LIVE" }),
        detectBot({
          mode: "LIVE",
          allow: ["CATEGORY:SEARCH_ENGINE", "CATEGORY:MONITOR"],
        }),
      ]
    : [
        shield({ mode: "DRY_RUN" }),
        detectBot({
          mode: "DRY_RUN",
          allow: ["CATEGORY:SEARCH_ENGINE", "CATEGORY:MONITOR"],
        }),
      ],
});

const authAj = arcjet({
  key: process.env.ARCJET_KEY || "ajkey_placeholder",
  characteristics: ["ip.src"],
  rules: isLive ? [shield({ mode: "LIVE" })] : [shield({ mode: "DRY_RUN" })],
});

export { shield, detectBot, fixedWindow, sensitiveInfo, tokenBucket };

// ─── Route-specific Arcjet clients ───────────────────────────────────────

/** Generic API protection — shield + bot detection only. */
export { aj };

const rateLimitMode = isLive ? "LIVE" : "DRY_RUN";

/** Auth nonce: 20 req/min per IP */
export const authNonceProtect = authAj.withRule(
  fixedWindow({
    mode: rateLimitMode,
    characteristics: ["ip.src"],
    window: "60s",
    max: 20,
  }),
);

/** Auth email start: 5 req/10min per IP only (email characteristic is optional — skip if empty) */
export const authEmailStartProtect = authAj
  .withRule(
    fixedWindow({
      mode: rateLimitMode,
      characteristics: ["ip.src"],
      window: "10m",
      max: 5,
    }),
  );

/** Auth email verify: 10 attempts per 10 minutes per IP */
export const authEmailVerifyProtect = authAj.withRule(
  fixedWindow({
    mode: rateLimitMode,
    characteristics: ["ip.src"],
    window: "10m",
    max: 10,
  }),
);

/** Team invite: 5 req/hour per team */
export const teamInviteProtect = aj.withRule(
  fixedWindow({
    mode: rateLimitMode,
    characteristics: ["teamId"],
    window: "1h",
    max: 5,
  }),
);

/** Invoice resend: 3 req/hour per invoice */
export const invoiceResendProtect = aj.withRule(
  fixedWindow({
    mode: rateLimitMode,
    characteristics: ["invoiceId"],
    window: "1h",
    max: 3,
  }),
);
