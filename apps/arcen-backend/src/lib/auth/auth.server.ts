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

export type DashboardSession = {
  sessionId: string;
  userId: string;
  // Compatibility alias for legacy code paths that still expect this field.
  clerkUserId: string;
  email: string | null;
  currentTeamId: string | null;
  walletAddress: string | null;
  expiresAt: Date;
};

function hashAuthValue(value: string): string {
  return createHmac("sha256", SIWE_JWT_SECRET).update(value).digest("hex");
}

function buildCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  };
}

async function readSessionToken(c: Context): Promise<string | null> {
  return getCookie(c, AUTH_COOKIE_NAME)?.trim() || null;
}

export async function getSessionFromCtx(c: Context): Promise<DashboardSession | null> {
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
      walletAddress: record.user.walletAddress ?? null,
      expiresAt,
    };
  }

  return {
    sessionId: record.id,
    userId: record.user.id,
    clerkUserId: record.user.id,
    email: record.user.email ?? null,
    currentTeamId: record.user.currentTeamId ?? null,
    walletAddress: record.user.walletAddress ?? null,
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

export async function requirePageSession(c: Context, next = "/login"): Promise<DashboardSession> {
  const session = await getSessionFromCtx(c);
  if (!session) {
    throw new Error(`Redirect: ${next}`);
  }
  return session;
}

export async function createSession(c: Context, userId: string): Promise<DashboardSession> {
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

  setCookie(c, AUTH_COOKIE_NAME, token, buildCookieOptions(expiresAt));

  return {
    sessionId: record.id,
    userId: user.id,
    clerkUserId: user.id,
    email: user.email ?? null,
    currentTeamId: user.currentTeamId ?? null,
    walletAddress: user.walletAddress ?? null,
    expiresAt,
  };
}

export async function refreshSession(c: Context, sessionId: string): Promise<void> {
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

  deleteCookie(c, AUTH_COOKIE_NAME);
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
