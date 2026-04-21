// ============================================================
//  Dashboard — Server-only auth helpers
//  Cookie-backed sessions stored in Prisma.
// ============================================================

import { createHmac, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { SIWE_JWT_SECRET } from "@/lib/config";
import { AUTH_COOKIE_NAME, AUTH_SESSION_TTL_MS } from "@/lib/auth-constants";

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

async function readSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(AUTH_COOKIE_NAME)?.value?.trim() || null;
}

export async function getSession(): Promise<DashboardSession | null> {
  const token = await readSessionToken();
  if (!token) return null;

  const now = new Date();
  const record = await db.authSession.findUnique({
    where: { tokenHash: hashAuthValue(token) },
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
  });

  if (!record || record.revokedAt || record.expiresAt <= now) {
    return null;
  }

  const staleAfter = 6 * 60 * 60 * 1000;
  if (now.getTime() - record.lastSeenAt.getTime() > staleAfter) {
    const expiresAt = new Date(now.getTime() + AUTH_SESSION_TTL_MS);
    await db.authSession.update({
      where: { id: record.id },
      data: {
        lastSeenAt: now,
        expiresAt,
      },
    });

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

export async function requirePageSession(next = "/login"): Promise<DashboardSession> {
  const session = await getSession();
  if (!session) redirect(next);
  return session;
}

export async function createSession(userId: string): Promise<DashboardSession> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + AUTH_SESSION_TTL_MS);

  const [store, user, record] = await Promise.all([
    cookies(),
    db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        currentTeamId: true,
        walletAddress: true,
      },
    }),
    db.authSession.create({
      data: {
        userId,
        tokenHash: hashAuthValue(token),
        expiresAt,
      },
    }),
  ]);

  if (!user) {
    throw new Error(`User ${userId} not found`);
  }

  store.set(AUTH_COOKIE_NAME, token, buildCookieOptions(expiresAt));

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

export async function refreshSession(sessionId: string): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + AUTH_SESSION_TTL_MS);
  await db.authSession.update({
    where: { id: sessionId },
    data: {
      lastSeenAt: now,
      expiresAt,
    },
  });

  const store = await cookies();
  const token = store.get(AUTH_COOKIE_NAME)?.value;
  if (token) {
    store.set(AUTH_COOKIE_NAME, token, buildCookieOptions(expiresAt));
  }
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(AUTH_COOKIE_NAME)?.value;
  if (token) {
    const tokenHash = hashAuthValue(token);
    await db.authSession.updateMany({
      where: {
        tokenHash,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  }

  store.delete(AUTH_COOKIE_NAME);
}

export async function getDbUser(userId: string) {
  return db.user.findUnique({ where: { id: userId } });
}

export function hashOpaqueToken(value: string): string {
  return hashAuthValue(value);
}

// SessionPayload alias for older imports.
export type ClerkSession = DashboardSession;
export type SessionPayload = DashboardSession;
