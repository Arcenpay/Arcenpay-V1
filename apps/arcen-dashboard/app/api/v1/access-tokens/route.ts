/**
 * POST /api/v1/access-tokens
 *
 * Generate a short-lived access token for embedding components in customer portals.
 * The token is scoped to a specific company+user and expires in 1 hour by default.
 *
 * Authorization: Bearer api_xxx
 */

import { NextRequest, NextResponse } from "next/server";
import { createHash, randomBytes } from "crypto";
import { requireApiKey, isApiKeyError } from "@/lib/api-key-auth";
import { db } from "@/lib/db";
import { resolveCompany, resolveUser, type CompanyKeys, type UserKeys } from "@/lib/flag-engine";

// Simple JWT-like token using HMAC-SHA256 (no external dependency needed)
function signToken(payload: Record<string, unknown>, secret: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const unsigned = `${header}.${body}`;
  const { createHmac } = require("crypto") as typeof import("crypto");
  const sig = createHmac("sha256", secret).update(unsigned).digest("base64url");
  return `${unsigned}.${sig}`;
}

export async function POST(req: NextRequest) {
  const ctx = await requireApiKey(req, { rateLimit: { limit: 100, windowMs: 60_000 } });
  if (isApiKeyError(ctx)) return ctx;

  const { teamId } = ctx;

  let body: {
    company?: CompanyKeys;
    user?: UserKeys;
    expires_in?: number; // seconds, default 3600
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const expiresIn = Math.min(body.expires_in ?? 3600, 86400); // max 24h
  const expiresAt = new Date(Date.now() + expiresIn * 1000);

  // Resolve company and user IDs
  const company = body.company ? await resolveCompany(teamId, body.company) : null;
  const user =
    body.user && company ? await resolveUser(teamId, body.user) : null;

  const secret = process.env.ACCESS_TOKEN_SECRET;
  if (!secret) {
    console.error("[access-tokens] ACCESS_TOKEN_SECRET not set");
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  const payload = {
    teamId,
    companyId: company?.id ?? null,
    userId: user?.id ?? null,
    exp: Math.floor(expiresAt.getTime() / 1000),
    iat: Math.floor(Date.now() / 1000),
    jti: randomBytes(16).toString("hex"), // unique token ID
  };

  const token = signToken(payload, secret);
  const tokenHash = createHash("sha256").update(token).digest("hex");

  // Store hash for revocation lookups
  await db.embedAccessToken.create({
    data: {
      teamId,
      tokenHash,
      companyId: company?.id ?? null,
      userId: user?.id ?? null,
      expiresAt,
    },
  });

  return NextResponse.json({
    data: {
      token,
      expires_at: expiresAt.toISOString(),
      company_id: company?.id ?? null,
      user_id: user?.id ?? null,
    },
  });
}
