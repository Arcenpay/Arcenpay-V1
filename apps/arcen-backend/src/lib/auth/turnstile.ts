/**
 * Cloudflare Turnstile verification for anonymous auth endpoints.
 *
 * WHY: email-code issuance, activation-key checks and wallet linking are all
 * reachable without a credential. Rate limiting alone still lets a distributed
 * bot farm burn through them at the per-IP ceiling. A Turnstile challenge makes
 * each attempt cost proof-of-work a script cannot cheaply mass-produce.
 *
 * GATING: completely inert unless `TURNSTILE_SECRET_KEY` resolves (and
 * `TURNSTILE_ENABLED` is not "false"). This keeps local dev and the test suite
 * working without a Cloudflare account. A missing key in production does NOT
 * crash the service — it disables the challenge and is reported by the loud
 * `assertDistinctSecrets` startup warning in config.ts (defense-in-depth only;
 * Arcjet + Redis rate limits still apply).
 */

import type { Context } from "hono";
import { TURNSTILE_ENABLED, TURNSTILE_SECRET_KEY } from "../../config.js";
import { resolveTrustedClientIp } from "./client-ip.js";
import { getSessionFromCtx } from "./auth.server.js";

const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export interface TurnstileResult {
  ok: boolean;
  reason?: string;
}

export function isTurnstileEnabled(): boolean {
  return TURNSTILE_ENABLED;
}

/** Verifies a Turnstile token against Cloudflare's siteverify endpoint. */
export async function verifyTurnstile(
  token: string | undefined,
  remoteIp?: string | null,
): Promise<TurnstileResult> {
  if (!TURNSTILE_ENABLED) return { ok: true, reason: "disabled" };
  if (!token) return { ok: false, reason: "missing-token" };

  try {
    const body = new URLSearchParams({
      secret: TURNSTILE_SECRET_KEY,
      response: token,
    });
    if (remoteIp) body.set("remoteip", remoteIp);

    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await res.json()) as {
      success?: boolean;
      "error-codes"?: string[];
    };
    if (data.success === true) return { ok: true };
    return {
      ok: false,
      reason: (data["error-codes"] ?? []).join(",") || "verification-failed",
    };
  } catch (err) {
    console.error(
      "[turnstile] siteverify request failed:",
      err instanceof Error ? err.message : String(err),
    );
    // Fail closed: an unreachable verifier must not become an open door.
    return { ok: false, reason: "siteverify-error" };
  }
}

/**
 * Route helper: reads the token from the (already parsed) JSON body — the
 * `cf-turnstile-response` field — or the `cf-turnstile-response` header, and
 * verifies it against the trusted client IP. Returns a 403 Response when the
 * challenge fails, or `null` when the request may proceed.
 */
export async function enforceTurnstile(
  c: Context,
  body: unknown,
): Promise<Response | null> {
  if (!TURNSTILE_ENABLED) return null;

  const fromBody =
    body && typeof body === "object"
      ? (body as Record<string, unknown>)["cf-turnstile-response"]
      : undefined;
  const token =
    typeof fromBody === "string"
      ? fromBody
      : c.req.header("cf-turnstile-response") ?? undefined;

  const ip = resolveTrustedClientIp(c.req.raw.headers);
  const result = await verifyTurnstile(token, ip);
  if (result.ok) return null;

  console.warn("[turnstile] challenge rejected", { reason: result.reason });
  return c.json(
    {
      ok: false,
      error: "Bot verification failed. Please complete the challenge and retry.",
      code: "CHALLENGE_FAILED",
    },
    403 as any,
  );
}

/**
 * Like `enforceTurnstile`, but skips the challenge for callers that already hold
 * a valid session. A signed-in user has proven identity, so the challenge would
 * only add friction to legitimate first-party flows (e.g. the dashboard
 * activation modal) without adding protection.
 */
export async function enforceTurnstileForAnonymous(
  c: Context,
  body: unknown,
): Promise<Response | null> {
  if (!TURNSTILE_ENABLED) return null;
  const session = await getSessionFromCtx(c);
  if (session) return null;
  return enforceTurnstile(c, body);
}
