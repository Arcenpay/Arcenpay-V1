/**
 * POST /api/v1/access-tokens
 *
 * Generate a short-lived embed access token scoped to a company+user.
 *
 * **Schematic-style upsert:** If the company doesn't exist yet it is created
 * automatically and assigned the free plan — no separate "identify" call needed.
 * The same applies to users: unknown users linked to a known company are auto-created.
 *
 * Authorization: Bearer api_xxx  (call from your backend, never expose API key client-side)
 *
 * Body:
 * {
 *   company?: { id?, email?, wallet?, name?, traits? }   // your customer
 *   user?:    { id?, clerk_user_id?, wallet?, name?, email?, traits? }
 *   expires_in?: number   // seconds, 60–86400, default 3600
 * }
 *
 * Response: { data: { token, expires_at, company_id, user_id } }
 */

import { NextRequest, NextResponse } from "next/server";
import { createHash, randomBytes } from "crypto";
import { createHmac } from "crypto";
import { requireAnyAuth, isAnyAuthError } from "@/lib/require-any-auth";
import { db } from "@/lib/db";
import { resolveCompany, resolveUser, type CompanyKeys, type UserKeys } from "@/lib/flag-engine";
import { deliverWebhook } from "@/lib/deliver-webhook";
import { Prisma } from "@/src/generated/prisma/client";

// ─── Simple JWT-like token (HMAC-SHA256, no external dep) ─────────────────────

function signToken(payload: Record<string, unknown>, secret: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const unsigned = `${header}.${body}`;
  const sig = createHmac("sha256", secret).update(unsigned).digest("base64url");
  return `${unsigned}.${sig}`;
}

// ─── Company upsert (create if not found) ─────────────────────────────────────

async function upsertCompanyForToken(
  teamId: string,
  keys: CompanyKeys & { name?: string; traits?: Record<string, unknown> },
): Promise<{ id: string; activePlanId: string | null; created: boolean }> {
  // Try to find existing company first
  const existing = await resolveCompany(teamId, keys);
  if (existing) return { id: existing.id, activePlanId: existing.activePlanId, created: false };

  // Not found — auto-create (Schematic-style)
  const created = await db.arcenCompany.create({
    data: {
      teamId,
      name: keys.name ?? keys.email ?? keys.id ?? "Unknown",
      email: keys.email ?? null,
      walletAddress: keys.wallet?.toLowerCase() ?? null,
      externalId: keys.id ?? null,
      traits: ((keys.traits ?? {}) as unknown) as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
  return { id: created.id, activePlanId: null, created: true };
}

// ─── User upsert (create if not found) ────────────────────────────────────────

async function upsertUserForToken(
  teamId: string,
  companyId: string,
  keys: UserKeys & { name?: string; email?: string; traits?: Record<string, unknown> },
): Promise<{ id: string; created: boolean }> {
  const existing = await resolveUser(teamId, keys);
  if (existing) return { id: existing.id, created: false };

  const created = await db.arcenUser.create({
    data: {
      teamId,
      companyId,
      walletAddress: keys.wallet?.toLowerCase() ?? null,
      clerkUserId: (keys as Record<string, unknown>).clerk_user_id as string | null ?? null,
      externalId: keys.id ?? null,
      name: keys.name ?? null,
      email: keys.email ?? null,
      traits: ((keys.traits ?? {}) as unknown) as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
  return { id: created.id, created: true };
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const ctx = await requireAnyAuth(req);
  if (isAnyAuthError(ctx)) return ctx;

  const { teamId } = ctx;

  let body: {
    company?: CompanyKeys & { name?: string; traits?: Record<string, unknown> };
    user?: UserKeys & { name?: string; email?: string; traits?: Record<string, unknown> };
    expires_in?: number; // seconds, default 3600
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // ── expiresIn validation ──────────────────────────────────────────────────
  const rawExpiresIn = body.expires_in ?? 3600;
  if (
    typeof rawExpiresIn !== "number" ||
    !Number.isFinite(rawExpiresIn) ||
    rawExpiresIn < 60 ||
    rawExpiresIn > 86400
  ) {
    return NextResponse.json(
      { error: "expires_in must be between 60 and 86400 seconds" },
      { status: 400 },
    );
  }
  const expiresIn = rawExpiresIn;
  const expiresAt = new Date(Date.now() + expiresIn * 1000);

  // ── Company: upsert (create if not exists) ───────────────────────────────
  let companyId: string | null = null;

  if (body.company && (body.company.id || body.company.wallet || body.company.email)) {
    const companyResult = await upsertCompanyForToken(teamId, body.company);
    companyId = companyResult.id;

    // Auto-assign free plan if no active plan
    let activePlanId = companyResult.activePlanId;
    if (!activePlanId) {
      const freePlan = await db.catalogPlan.findFirst({
        where: { teamId, status: "PUBLISHED", active: true },
        orderBy: [{ price: "asc" }],
        select: { id: true },
      });
      if (freePlan) {
        await db.arcenCompany.update({
          where: { id: companyId },
          data: { activePlanId: freePlan.id },
        });
        activePlanId = freePlan.id;
      }
    }

    // Fire webhook for newly-created companies (non-blocking)
    if (companyResult.created) {
      deliverWebhook(teamId, "company.created", {
        companyId,
        externalId: body.company.id ?? null,
        source: "access_token",
      }).catch(() => {});
    }
  }

  // ── User: upsert (create if not exists) ─────────────────────────────────
  let userId: string | null = null;

  if (body.user && companyId && (body.user.id || (body.user as Record<string, unknown>).clerk_user_id || body.user.wallet)) {
    const userResult = await upsertUserForToken(teamId, companyId, body.user);
    userId = userResult.id;

    if (userResult.created) {
      deliverWebhook(teamId, "user.created", { userId, companyId, source: "access_token" }).catch(
        () => {},
      );
    }
  }

  // ── Sign and store token ─────────────────────────────────────────────────
  const secret = process.env.ACCESS_TOKEN_SECRET;
  if (!secret) {
    console.error("[access-tokens] ACCESS_TOKEN_SECRET not set");
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  const payload = {
    teamId,
    companyId,
    userId,
    exp: Math.floor(expiresAt.getTime() / 1000),
    iat: Math.floor(Date.now() / 1000),
    jti: randomBytes(16).toString("hex"),
  };

  const token = signToken(payload, secret);
  const tokenHash = createHash("sha256").update(token).digest("hex");

  await db.embedAccessToken.create({
    data: { teamId, tokenHash, companyId, userId, expiresAt },
  });

  return NextResponse.json({
    data: {
      token,
      expires_at: expiresAt.toISOString(),
      company_id: companyId,
      user_id: userId,
    },
  });
}
