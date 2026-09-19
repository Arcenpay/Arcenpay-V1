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
 * Bypassed traffic (docs playground + any request carrying a valid sk_/rk_
 * API key) is authenticated downstream by the per-key auth path, which keeps
 * its own 500 req/min limit for non-docs callers.
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
    token.startsWith("rk_test_")
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
