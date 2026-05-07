/**
 * POST /api/v1/access-tokens
 *
 * Generate a short-lived embed access token scoped to a company+user.
 *
 * **Schematic-style upsert:** If the company doesn't exist yet it is created
 * automatically and assigned the configured initial plan — no separate
 * "identify" call needed.
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
import { corsHeaders } from "@/lib/cors";
import {
  resolveCompany,
  resolveUser,
  type CompanyKeys,
  type UserKeys,
} from "@/lib/flag-engine";
import { deliverWebhook } from "@/lib/deliver-webhook";
import { Prisma } from "@/src/generated/prisma/client";
import { resolveDashboardSessionIdentityDefaults } from "@/lib/dashboard-session-identity";
import { getSession } from "@/lib/auth.server";
import { resolvePublishedInitialPlan } from "@/lib/catalog-billing";

// ─── Simple JWT-like token (HMAC-SHA256, no external dep) ─────────────────────

function signToken(payload: Record<string, unknown>, secret: string): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const unsigned = `${header}.${body}`;
  const sig = createHmac("sha256", secret).update(unsigned).digest("base64url");
  return `${unsigned}.${sig}`;
}

function toNullableTrimmed(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toNormalizedEmail(value: string | undefined): string | null {
  const trimmed = toNullableTrimmed(value);
  return trimmed ? trimmed.toLowerCase() : null;
}

function isPrismaUniqueError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

// ─── Company upsert (create if not found) ─────────────────────────────────────

async function upsertCompanyForToken(
  teamId: string,
  keys: CompanyKeys & { name?: string; traits?: Record<string, unknown> },
): Promise<{ id: string; activePlanId: string | null; created: boolean }> {
  // Try to find existing company first
  const existing = await resolveCompany(teamId, keys);
  if (existing) {
    const updates: Record<string, unknown> = {};
    const nextName = toNullableTrimmed(keys.name);
    const nextEmail = toNormalizedEmail(keys.email);
    const nextWallet = toNullableTrimmed(keys.wallet)?.toLowerCase() ?? null;

    if (nextName) updates.name = nextName;
    if (nextEmail) updates.email = nextEmail;
    if (nextWallet) updates.walletAddress = nextWallet;
    if (Object.keys(updates).length > 0) {
      await db.arcenCompany.update({
        where: { id: existing.id },
        data: updates,
      });
    }
    return {
      id: existing.id,
      activePlanId: existing.activePlanId,
      created: false,
    };
  }

  const externalId = toNullableTrimmed(keys.id);
  const email = toNormalizedEmail(keys.email);
  const wallet = toNullableTrimmed(keys.wallet)?.toLowerCase() ?? null;
  const fallbackName =
    toNullableTrimmed(keys.name) ?? email ?? externalId ?? wallet ?? "Unknown";

  // Not found — auto-create (Schematic-style)
  try {
    const created = await db.arcenCompany.create({
      data: {
        teamId,
        name: fallbackName,
        email,
        walletAddress: wallet,
        externalId,
        traits: (keys.traits ?? {}) as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    return { id: created.id, activePlanId: null, created: true };
  } catch (error) {
    // Concurrent token requests can race during auto-create. Resolve again and return existing row.
    if (isPrismaUniqueError(error)) {
      const resolved = await resolveCompany(teamId, {
        ...keys,
        ...(externalId ? { id: externalId } : {}),
        ...(email ? { email } : {}),
        ...(wallet ? { wallet } : {}),
      });
      if (resolved) {
        return {
          id: resolved.id,
          activePlanId: resolved.activePlanId,
          created: false,
        };
      }
    }
    throw error;
  }
}

// ─── User upsert (create if not found) ────────────────────────────────────────

async function upsertUserForToken(
  teamId: string,
  companyId: string,
  keys: UserKeys & {
    name?: string;
    email?: string;
    traits?: Record<string, unknown>;
  },
): Promise<{ id: string; created: boolean }> {
  const existing = await resolveUser(teamId, keys);
  if (existing) {
    const updates: Record<string, unknown> = {};
    const nextName = toNullableTrimmed(keys.name);
    const nextEmail = toNormalizedEmail(keys.email);
    const nextWallet = toNullableTrimmed(keys.wallet)?.toLowerCase() ?? null;
    const nextClerkUserId =
      toNullableTrimmed(
        (keys as Record<string, unknown>).clerk_user_id as string | undefined,
      ) ?? toNullableTrimmed(keys.clerkUserId);

    if (existing.companyId !== companyId) updates.companyId = companyId;
    if (nextName) updates.name = nextName;
    if (nextEmail) updates.email = nextEmail;
    if (nextWallet) updates.walletAddress = nextWallet;
    if (nextClerkUserId) updates.clerkUserId = nextClerkUserId;

    if (Object.keys(updates).length > 0) {
      await db.arcenUser.update({
        where: { id: existing.id },
        data: updates,
      });
    }

    return { id: existing.id, created: false };
  }

  const externalId = toNullableTrimmed(keys.id);
  const email = toNormalizedEmail(keys.email);
  const wallet = toNullableTrimmed(keys.wallet)?.toLowerCase() ?? null;
  const clerkUserId =
    toNullableTrimmed(
      (keys as Record<string, unknown>).clerk_user_id as string | undefined,
    ) ?? toNullableTrimmed(keys.clerkUserId);

  try {
    const created = await db.arcenUser.create({
      data: {
        teamId,
        companyId,
        walletAddress: wallet,
        clerkUserId,
        externalId,
        name: toNullableTrimmed(keys.name),
        email,
        traits: (keys.traits ?? {}) as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    return { id: created.id, created: true };
  } catch (error) {
    if (isPrismaUniqueError(error)) {
      const resolved = await resolveUser(teamId, {
        ...keys,
        ...(externalId ? { id: externalId } : {}),
        ...(wallet ? { wallet } : {}),
        ...(clerkUserId ? { clerkUserId } : {}),
        ...(email ? { email } : {}),
      });
      if (resolved) return { id: resolved.id, created: false };
    }
    throw error;
  }
}

// ─── Route handlers ──────────────────────────────────────────────────────────

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(req.headers.get("origin")),
  });
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  const ctx = await requireAnyAuth(req);
  if (isAnyAuthError(ctx)) return ctx;

  const { teamId } = ctx;

  let body: {
    company?: CompanyKeys & { name?: string; traits?: Record<string, unknown> };
    user?: UserKeys & {
      name?: string;
      email?: string;
      traits?: Record<string, unknown>;
    };
    expires_in?: number; // seconds, default 3600
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body"  }, { status: 400, headers: corsHeaders(origin) });
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

  const session = ctx.source === "session" ? await getSession() : null;
  const sessionDefaults =
    ctx.source === "session" && session
      ? await resolveDashboardSessionIdentityDefaults(
          teamId,
          session.clerkUserId,
        )
      : null;

  const normalizedCompany =
    body.company ??
    (sessionDefaults
      ? {
          ...(sessionDefaults.companyId
            ? { id: sessionDefaults.companyId }
            : {}),
          wallet: sessionDefaults.walletAddress ?? undefined,
          email: sessionDefaults.companyEmail ?? undefined,
          name: sessionDefaults.companyName ?? undefined,
        }
      : undefined);

  const normalizedUser =
    body.user ??
    (sessionDefaults
      ? {
          ...(sessionDefaults.userId ? { id: sessionDefaults.userId } : {}),
          clerk_user_id: sessionDefaults.clerkUserId,
          wallet: sessionDefaults.walletAddress ?? undefined,
          name: sessionDefaults.userName ?? undefined,
          email: sessionDefaults.userEmail ?? undefined,
        }
      : undefined);

  const companyInput = normalizedCompany
    ? {
        ...normalizedCompany,
        ...(sessionDefaults && {
          name:
            normalizedCompany.name ?? sessionDefaults.companyName ?? undefined,
          email:
            normalizedCompany.email ??
            sessionDefaults.companyEmail ??
            undefined,
          wallet:
            normalizedCompany.wallet ??
            sessionDefaults.walletAddress ??
            undefined,
        }),
      }
    : undefined;

  const userInput = normalizedUser
    ? {
        ...normalizedUser,
        ...(sessionDefaults && {
          id: normalizedUser.id ?? sessionDefaults.userId ?? undefined,
          clerk_user_id:
            (normalizedUser as Record<string, unknown>).clerk_user_id ??
            sessionDefaults.clerkUserId,
          wallet:
            normalizedUser.wallet ?? sessionDefaults.walletAddress ?? undefined,
          name: normalizedUser.name ?? sessionDefaults.userName ?? undefined,
          email: normalizedUser.email ?? sessionDefaults.userEmail ?? undefined,
        }),
      }
    : undefined;

  // ── Company: upsert (create if not exists) ───────────────────────────────
  let companyId: string | null = null;

  if (
    companyInput &&
    (companyInput.id || companyInput.wallet || companyInput.email)
  ) {
    const companyResult = await upsertCompanyForToken(teamId, companyInput);
    companyId = companyResult.id;

    // Auto-assign the owner-configured initial plan if no active plan
    let activePlanId = companyResult.activePlanId;
    if (!activePlanId) {
      const initialPlan = await resolvePublishedInitialPlan(teamId);
      if (initialPlan) {
        await db.arcenCompany.update({
          where: { id: companyId },
          data: { activePlanId: initialPlan.id },
        });
        activePlanId = initialPlan.id;
      } else {
        return NextResponse.json(
          {
            error:
              "No published initial plan is configured for this workspace. Publish a plan and set it as the initial plan before issuing new access tokens.",
          },
          { status: 409 },
        );
      }
    }

    // Fire webhook for newly-created companies (non-blocking)
    if (companyResult.created) {
      deliverWebhook(teamId, "company.created", {
        companyId,
        externalId: companyInput.id ?? null,
        source: "access_token",
      }).catch(() => {});
    }
  }

  // ── User: upsert (create if not exists) ─────────────────────────────────
  let userId: string | null = null;

  if (
    userInput &&
    companyId &&
    (userInput.id ||
      (userInput as Record<string, unknown>).clerk_user_id ||
      userInput.wallet ||
      userInput.email)
  ) {
    const userResult = await upsertUserForToken(teamId, companyId, userInput);
    userId = userResult.id;

    if (userResult.created) {
      deliverWebhook(teamId, "user.created", {
        userId,
        companyId,
        source: "access_token",
      }).catch(() => {});
    }
  }

  // ── Sign and store token ─────────────────────────────────────────────────
  const secret = process.env.ACCESS_TOKEN_SECRET;
  if (!secret) {
    console.error("[access-tokens] ACCESS_TOKEN_SECRET not set");
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 },
    );
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
  }, { headers: corsHeaders(origin) });
}
