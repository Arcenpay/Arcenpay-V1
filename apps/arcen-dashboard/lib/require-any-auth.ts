/**
 * Dual-authentication helper for /api/v1/* routes.
 *
 * API routes may be called either:
 *  - Externally, by a DApp backend using "Authorization: Bearer api_xxx"
 *  - Internally, by the ArcenPay dashboard UI using a Clerk session cookie
 *
 * This helper tries API key auth first. If no api_ token is present it falls
 * back to Clerk session auth. Returns { teamId } on success or a 401/403
 * NextResponse on failure.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireApiKey, isApiKeyError } from "@/lib/api-key-auth";
import { getSession } from "@/lib/auth.server";
import { resolveTeamContext } from "@/lib/team-session";

export type AnyAuthContext = {
  teamId: string;
  source: "api_key" | "session";
  apiKeyId?: string;
};

export function isAnyAuthError(v: unknown): v is NextResponse {
  return v instanceof NextResponse;
}

function looksLikeApiKey(req: NextRequest): boolean {
  const auth = req.headers.get("authorization") ?? req.headers.get("x-api-key");
  if (!auth) return false;
  // Bearer api_... or raw api_...
  return auth.startsWith("api_") || auth.startsWith("Bearer api_");
}

export async function requireAnyAuth(
  req: NextRequest,
): Promise<AnyAuthContext | NextResponse> {
  // ── API key path ──────────────────────────────────────────────────────────
  if (looksLikeApiKey(req)) {
    const ctx = await requireApiKey(req);
    if (isApiKeyError(ctx)) return ctx; // propagate 401/429
    return { teamId: ctx.teamId, source: "api_key", apiKeyId: ctx.apiKeyId };
  }

  // ── Clerk session path ────────────────────────────────────────────────────
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const teamCtx = await resolveTeamContext(session);
  if (!teamCtx) {
    return NextResponse.json({ error: "No team found" }, { status: 403 });
  }

  return { teamId: teamCtx.teamId, source: "session" };
}
