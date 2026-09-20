// ============================================================
//  Dashboard — Server-only auth helpers
//  Cookie-backed sessions stored in Prisma.
// ============================================================

import { createHmac, randomBytes } from "node:crypto";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Context } from "hono";
import { withPrismaReconnect } from "../../db.js";
import { SIWE_JWT_SECRET } from "../../config.js";
import { AUTH_COOKIE_NAME, AUTH_SESSION_TTL_MS } from "./auth-constants.js";

// Both the dashboard (app.arcenpay.com) and API (api.arcenpay.com) must read
// the same session. A host-only API cookie authenticates API fetches but is
// invisible to the dashboard, which creates a successful-login → /login loop.
const PRODUCTION_SESSION_COOKIE_DOMAIN = ".arcenpay.com";

export type DashboardSession = {
  sessionId: string;
  userId: string;
  // Compatibility alias for legacy code paths that still expect this field.
  clerkUserId: string;
  email: string | null;
  currentTeamId: string | null;
  activeEnvironmentId: string | null;
  walletAddress: string | null;
  stellarWalletAddress: string | null;
  expiresAt: Date;
};

function hashAuthValue(value: string): string {
  return createHmac("sha256", SIWE_JWT_SECRET).update(value).digest("hex");
}

/**
 * Session cookie `SameSite` policy.
 *
 * SECURITY: production previously hardcoded `SameSite=None`. That instructs the
 * browser to attach the session cookie to requests initiated by ANY other site,
 * which is precisely the precondition CSRF needs. Because the cookie is scoped
 * to `.arcenpay.com` (shared by app/api), a genuinely cross-site deployment is
 * not required: `app.arcenpay.com` → `api.arcenpay.com` is already same-site,
 * so `Lax` covers the normal dashboard flow.
 *
 * `none` remains available for deployments that truly need a third-party
 * context, but it must be requested explicitly, and the API-level CSRF guard
 * (`middleware/csrf-origin.ts`) still rejects foreign-origin state changes.
 */
const AUTH_COOKIE_SAME_SITE: "lax" | "strict" | "none" = (() => {
  const raw = process.env.AUTH_COOKIE_SAME_SITE?.trim().toLowerCase();
  if (raw === "none" || raw === "strict" || raw === "lax") return raw;
  return "lax";
})();

function buildCookieOptions(expiresAt: Date) {
  const isProd = process.env.NODE_ENV === "production";
  // `SameSite=None` is only honoured by browsers when the cookie is also
  // `Secure`; force it so a misconfiguration cannot silently drop the cookie.
  const secure = isProd || AUTH_COOKIE_SAME_SITE === "none";
  return {
    httpOnly: true,
    sameSite: AUTH_COOKIE_SAME_SITE,
    secure,
    ...(isProd
      ? { domain: PRODUCTION_SESSION_COOKIE_DOMAIN }
      : {}),
    path: "/",
    expires: expiresAt,
  };
}

function clearLegacyHostOnlySessionCookie(c: Context): void {
  if (process.env.NODE_ENV === "production") {
    // Delete a previous api.arcenpay.com-scoped cookie before setting the
    // shared parent-domain cookie. Otherwise browsers can send the stale
    // host-only value first when calling the API.
    deleteCookie(c, AUTH_COOKIE_NAME, {
      httpOnly: true,
      sameSite: AUTH_COOKIE_SAME_SITE,
      secure: true,
      path: "/",
    });
  }
}

async function readSessionToken(c: Context): Promise<string | null> {
  return getCookie(c, AUTH_COOKIE_NAME)?.trim() || null;
}

export async function getSessionFromCtx(
  c: Context,
): Promise<DashboardSession | null> {
  const token = await readSessionToken(c);
  if (!token) return null;

  const now = new Date();
  const tokenHash = hashAuthValue(token);
  const record = await withPrismaReconnect((client) =>
    client.authSession.findUnique({
      where: { tokenHash },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            currentTeamId: true,
            walletAddress: true,
            stellarWalletAddress: true,
          },
        },
      },
    }),
  );

  if (!record || record.revokedAt || record.expiresAt <= now) {
    return null;
  }

  const staleAfter = 6 * 60 * 60 * 1000;
  if (now.getTime() - record.lastSeenAt.getTime() > staleAfter) {
    const expiresAt = new Date(now.getTime() + AUTH_SESSION_TTL_MS);
    await withPrismaReconnect((client) =>
      client.authSession.update({
        where: { id: record.id },
        data: {
          lastSeenAt: now,
          expiresAt,
        },
      }),
    );

    return {
      sessionId: record.id,
      userId: record.user.id,
      clerkUserId: record.user.id,
      email: record.user.email ?? null,
      currentTeamId: record.user.currentTeamId ?? null,
      activeEnvironmentId: record.activeEnvironmentId ?? null,
      walletAddress: record.user.walletAddress ?? null,
      stellarWalletAddress: record.user.stellarWalletAddress ?? null,
      expiresAt,
    };
  }

  return {
    sessionId: record.id,
    userId: record.user.id,
    clerkUserId: record.user.id,
    email: record.user.email ?? null,
    currentTeamId: record.user.currentTeamId ?? null,
    activeEnvironmentId: record.activeEnvironmentId ?? null,
    walletAddress: record.user.walletAddress ?? null,
    stellarWalletAddress: record.user.stellarWalletAddress ?? null,
    expiresAt: record.expiresAt,
  };
}

/** Legacy alias — requires a Hono Context parameter now.
 *  Prefer getSessionFromCtx for clarity. */
export function getSession(): never {
  throw new Error(
    "getSession() now requires a Hono Context. Use getSessionFromCtx(c) instead.",
  );
}

export async function requirePageSession(
  c: Context,
  next = "/login",
): Promise<DashboardSession> {
  const session = await getSessionFromCtx(c);
  if (!session) {
    throw new Error(`Redirect: ${next}`);
  }
  return session;
}

export async function createSession(
  c: Context,
  userId: string,
): Promise<DashboardSession> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + AUTH_SESSION_TTL_MS);

  const [user, record] = await Promise.all([
    withPrismaReconnect((client) =>
      client.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          currentTeamId: true,
          walletAddress: true,
          stellarWalletAddress: true,
        },
      }),
    ),
    withPrismaReconnect((client) =>
      client.authSession.create({
        data: {
          userId,
          tokenHash: hashAuthValue(token),
          expiresAt,
        },
      }),
    ),
  ]);

  if (!user) {
    throw new Error(`User ${userId} not found`);
  }

  const currentTeamId = user.currentTeamId;
  const activeEnvironmentId = currentTeamId
    ? ((
        await withPrismaReconnect((client) =>
          client.workspaceEnvironment.findFirst({
            where: { teamId: currentTeamId },
            orderBy: { createdAt: "asc" },
            select: { id: true },
          }),
        )
      )?.id ?? null)
    : null;

  if (activeEnvironmentId) {
    await withPrismaReconnect((client) =>
      client.authSession.update({
        where: { id: record.id },
        data: { activeEnvironmentId },
      }),
    );
  }

  clearLegacyHostOnlySessionCookie(c);
  setCookie(c, AUTH_COOKIE_NAME, token, buildCookieOptions(expiresAt));

  return {
    sessionId: record.id,
    userId: user.id,
    clerkUserId: user.id,
    email: user.email ?? null,
    currentTeamId: user.currentTeamId ?? null,
    activeEnvironmentId,
    walletAddress: user.walletAddress ?? null,
    stellarWalletAddress: user.stellarWalletAddress ?? null,
    expiresAt,
  };
}

export async function refreshSession(
  c: Context,
  sessionId: string,
): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + AUTH_SESSION_TTL_MS);
  await withPrismaReconnect((client) =>
    client.authSession.update({
      where: { id: sessionId },
      data: {
        lastSeenAt: now,
        expiresAt,
      },
    }),
  );

  const token = getCookie(c, AUTH_COOKIE_NAME);
  if (token) {
    clearLegacyHostOnlySessionCookie(c);
    setCookie(c, AUTH_COOKIE_NAME, token, buildCookieOptions(expiresAt));
  }
}

export async function clearSession(c: Context): Promise<void> {
  const token = getCookie(c, AUTH_COOKIE_NAME);
  if (token) {
    const tokenHash = hashAuthValue(token);
    await withPrismaReconnect((client) =>
      client.authSession.updateMany({
        where: {
          tokenHash,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      }),
    );
  }

  clearLegacyHostOnlySessionCookie(c);
  deleteCookie(c, AUTH_COOKIE_NAME, buildCookieOptions(new Date(0)));
}

export async function getDbUser(userId: string) {
  return withPrismaReconnect((client) =>
    client.user.findUnique({ where: { id: userId } }),
  );
}

export function hashOpaqueToken(value: string): string {
  return hashAuthValue(value);
}

// SessionPayload alias for older imports.
export type ClerkSession = DashboardSession;
export type SessionPayload = DashboardSession;
