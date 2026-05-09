/**
 * Dual-authentication helper for /api/v1/* routes.
 *
 * API routes may be called either:
 *  - Externally, by a DApp backend using "Authorization: Bearer api_xxx"
 *  - Internally, by the ArcenPay dashboard UI using a session cookie
 *
 * This helper tries API key auth first. If no api_ token is present it falls
 * back to session auth. Returns { teamId } on success or an error object on failure.
 */

import { requireApiKey, isApiKeyError } from "./api-key-auth.js";
import { getSessionFromCtx } from "./auth.server.js";
import { resolveTeamContext } from "./team-session.js";
import type { Context } from "hono";

export type AnyAuthContext = {
  teamId: string;
  source: "api_key" | "session";
  apiKeyId?: string;
};

export type AnyAuthError = { error: string; status: number };

export function isAnyAuthError(v: unknown): v is AnyAuthError {
  return (
    typeof v === "object" &&
    v !== null &&
    "error" in v &&
    "status" in v
  );
}

function looksLikeApiKey(c: Context): boolean {
  const auth = c.req.header("authorization") ?? c.req.header("x-api-key");
  if (!auth) return false;
  return auth.startsWith("api_") || auth.startsWith("Bearer api_");
}

export async function requireAnyAuth(
  c: Context,
): Promise<AnyAuthContext | AnyAuthError> {
  // ── API key path ──────────────────────────────────────────────────────────
  if (looksLikeApiKey(c)) {
    const ctx = await requireApiKey(c.req.raw);
    if (isApiKeyError(ctx)) return ctx;
    return { teamId: ctx.teamId, source: "api_key", apiKeyId: ctx.apiKeyId };
  }

  // ── Session path ──────────────────────────────────────────────────────────
  const session = await getSessionFromCtx(c);
  if (!session) {
    return { error: "Unauthorized", status: 401 };
  }

  const teamCtx = await resolveTeamContext(session);
  if (!teamCtx) {
    return { error: "No team found", status: 403 };
  }

  return { teamId: teamCtx.teamId, source: "session" };
}
