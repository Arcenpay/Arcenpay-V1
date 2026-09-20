import arcjet, {
  shield,
  detectBot,
  fixedWindow,
  sensitiveInfo,
  tokenBucket,
} from "@arcjet/node";
import { createHash } from "crypto";
import { isIP } from "node:net";
import { db } from "../../db.js";

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
 * Number of trusted reverse proxies in front of this service.
 *
 * SECURITY: `X-Forwarded-For` is a *client-writable* header. Taking the FIRST
 * entry (the historical behaviour here) let any caller spoof an arbitrary IP
 * and rotate it per request, which silently disabled every IP-based control —
 * auth nonce/email rate limits and Arcjet shield/bot fingerprinting.
 *
 * Each proxy in the chain APPENDS the address of the peer it received the
 * request from. Therefore the last `TRUSTED_PROXY_HOPS` entries were written by
 * infrastructure we control, and the entry at exactly that offset is the real
 * client. With the default of 1 (Railway/Vercel/one nginx), the RIGHTMOST entry
 * is authoritative and everything to its left is attacker-controlled.
 */
const TRUSTED_PROXY_HOPS: number = (() => {
  const raw = process.env.TRUSTED_PROXY_HOPS?.trim();
  if (!raw) return 1;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 1;
})();

/** Strict IP validation so garbage can never reach an Arcjet fingerprint. */
function isValidIp(value: string | undefined): value is string {
  if (!value) return false;
  return isIP(value) !== 0;
}

/**
 * Public wrapper over the trusted-proxy IP resolution.
 *
 * Use this anywhere an audit record, rate-limit key, or log line needs a client
 * IP. Never read `x-forwarded-for` directly at a call site — the leftmost entry
 * is attacker-supplied.
 */
export function resolveTrustedClientIp(headers: {
  get(name: string): string | null | undefined;
}): string | null {
  return extractTrustedClientIp((name) => headers.get(name) ?? null);
}

/**
 * Resolves the real client IP from the forwarded chain using the trusted-proxy
 * hop count. Returns `null` when no trustworthy address can be determined.
 */
function extractTrustedClientIp(get: (name: string) => string | null): string | null {
  const forwarded = get("x-forwarded-for");
  if (forwarded) {
    const chain = forwarded
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);

    if (chain.length > 0) {
      // Walk from the right: skip the entries appended by our own proxies.
      const index = chain.length - TRUSTED_PROXY_HOPS;
      const candidate = index >= 0 ? chain[index] : undefined;
      if (isValidIp(candidate)) return candidate;
    }
  }

  // `x-real-ip` / `cf-connecting-ip` are only meaningful when the edge
  // overwrites them. They are never trusted for the *leftmost* hop decision,
  // and only consulted when they validate as a real IP.
  const realIp = get("x-real-ip")?.trim();
  if (isValidIp(realIp)) return realIp;

  const cfIp = get("cf-connecting-ip")?.trim();
  if (isValidIp(cfIp)) return cfIp;

  return null;
}

/**
 * Builds an Arcjet-Node-compatible request with a client IP so fingerprinting
 * via the `ip.src` characteristic NEVER fails.
 *
 * Hono's `c.req.raw` is a Web `Request` — it has no Node `socket.remoteAddress`.
 * When Arcjet needs `ip.src` (rate limits, shield, bot detection) it throws
 * "Failed to build fingerprint … value was empty" if the IP is missing, which
 * would 500 the request.
 *
 * SECURITY: the resolved IP is derived ONLY from proxy-appended hops (see
 * `extractTrustedClientIp`) and strictly validated. When no trustworthy IP is
 * available we must NOT collapse every caller into one shared bucket (that lets
 * a single attacker exhaust the limit for everyone). Instead we fall back to a
 * key derived from the raw forwarded chain so distinct clients stay distinct,
 * and log an actionable warning in production.
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

  let clientIp: string | null = null;
  if (get) {
    clientIp = extractTrustedClientIp(get);
  } else {
    const candidate =
      (request as any).ip ??
      (request as any).xForwardedFor ??
      (request as any).remoteAddress;
    clientIp = isValidIp(typeof candidate === "string" ? candidate : undefined)
      ? candidate
      : null;
  }

  if (!clientIp) {
    const rawChain = get?.( "x-forwarded-for") ?? "";
    // Deterministic per-presented-chain pseudo-key: keeps buckets separate
    // without ever making one shared/global bucket the failure mode.
    const digest = createHash("sha256")
      .update(rawChain || "unattributable")
      .digest("hex")
      .slice(0, 32);
    if (process.env.NODE_ENV === "production") {
      console.warn(
        "[arcjet] Could not resolve a trusted client IP from the forwarded chain. " +
          "Check the proxy configuration and TRUSTED_PROXY_HOPS. " +
          "Falling back to a derived fingerprint bucket.",
      );
    }
    // 198.18.0.0/15 is the reserved benchmarking range — never a real client.
    clientIp = `198.18.${parseInt(digest.slice(0, 2), 16)}.${parseInt(digest.slice(2, 4), 16)}`;
  }

  const method = get
    ? undefined // tolerate standard Request (method read by Arcjet internally)
    : (request as any).method ?? undefined;
  const url = get ? undefined : (request as any).url ?? undefined;

  const forwardedHeaders: Record<string, string> = get
    ? Object.fromEntries(headers.entries())
    : { ...(headers ?? {}) };

  // Arcjet's `detectBot` rule REQUIRES a `user-agent` header. When it is absent
  // the rule errors out (observed as: "Failure running rule: BOT due to
  // DetectBot requires `user-agent` header to be set") instead of simply not
  // matching — which can deny or break perfectly legitimate requests. Supplying
  // a neutral placeholder keeps the rule evaluable; genuine bots still carry
  // their real UA and are detected normally.
  const hasUserAgent = Object.keys(forwardedHeaders).some(
    (key) => key.toLowerCase() === "user-agent",
  );
  if (!hasUserAgent) {
    forwardedHeaders["user-agent"] = "arcenpay-client";
  }

  return {
    ...(request instanceof Request
      ? request
      : request),
    headers: forwardedHeaders,
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
 * Returns true when the request carries an `Origin`/`Referer` of the ArcenPay
 * docs playground.
 *
 * SECURITY NOTICE — THIS IS NOT A SECURITY BOUNDARY.
 * `Origin` and `Referer` are request headers, i.e. fully client-controlled.
 * `curl -H 'Origin: https://docs.arcenpay.com' …` satisfies this check. It
 * therefore must NEVER be used to grant a bypass, an exemption, or elevated
 * trust. It exists purely for telemetry / analytics bucket separation.
 *
 * The Mintlify "Try it" playground always sends the caller's *real* API key, so
 * it keeps working through the key-verified path with no exemption required.
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
 * Returns true when this request should bypass GLOBAL bot-detection / shield
 * protection.
 *
 * SECURITY: the ONLY accepted reason is a key that is PROVABLY registered on
 * this platform (valid, not revoked, not expired — verified against the DB by
 * hash). It deliberately does NOT trust:
 *   - a key merely *shaped* like ours (`sk_`/`rk_`/`pk_` prefix ⇒ guessing a
 *     prefix must not dodge bot/shield), or
 *   - the `Origin`/`Referer` header (client-controlled ⇒ trivially forged).
 *
 * Returns a Promise<boolean>; callers must `await` it before deciding.
 */
export async function shouldBypassGlobalProtection(
  request: Request | Record<string, any>,
): Promise<boolean> {
  // Extract + hash the presented credential. No header-based bypass exists.
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
  // Fail-closed: if the token doesn't even match a known credential format,
  // it definitely isn't one of our keys.
  const looksLikeKey =
    token.startsWith("sk_live_") ||
    token.startsWith("sk_test_") ||
    token.startsWith("rk_live_") ||
    token.startsWith("rk_test_") ||
    token.startsWith("pk_live_") ||
    token.startsWith("pk_test_");
  if (!looksLikeKey) return false;

  // Verify against the DB — the ONLY source of truth. Unknown, revoked, or
  // expired keys get NO bypass (they fall through to bot/shield).
  try {
    const hash = createHash("sha256").update(token).digest("hex");
    const keyRecord = await db.arcenApiKey.findUnique({
      where: { keyHash: hash },
      select: { id: true, revokedAt: true, expiresAt: true },
    });
    if (!keyRecord || keyRecord.revokedAt) return false;
    if (keyRecord.expiresAt && keyRecord.expiresAt.getTime() <= Date.now()) {
      return false;
    }
    return true;
  } catch {
    // On DB failure, fail-closed → treat as not-bypassable (bot/shield applies).
    return false;
  }
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
