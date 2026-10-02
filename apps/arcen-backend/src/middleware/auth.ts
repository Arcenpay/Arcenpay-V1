import { createHmac, createHash } from "node:crypto";
import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { db, withPrismaReconnect } from "../db.js";
import { SIWE_JWT_SECRET, PLATFORM_ADMIN_SECRET, isPlatformAdminEmail } from "../config.js";
import { isApiKeyToken } from "../lib/auth/api-key-auth.js";
import { verifyFacilitatorToken } from "../lib/auth/facilitator-auth.js";
import { secureCompare, readCookieValue } from "../lib/auth/secure-compare.js";
import {
  getCachedSession,
  setCachedSession,
  invalidateSessionCache,
} from "../lib/auth/session-cache.js";

const AUTH_COOKIE_NAME = "arcen_session";
const ADMIN_SECRET_COOKIE_NAME = "arcen_admin_secret";
const AUTH_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface AuthSession {
  sessionId: string;
  userId: string;
  email: string | null;
  currentTeamId: string | null;
  activeEnvironmentId: string | null;
  walletAddress: string | null;
  stellarWalletAddress: string | null;
  solanaWalletAddress: string | null;
  expiresAt: Date;
}

function hashAuthValue(value: string): string {
  return createHmac("sha256", SIWE_JWT_SECRET).update(value).digest("hex");
}

function getBearerToken(c: Context): string | null {
  const auth = c.req.header("authorization");
  if (!auth) return null;
  if (auth.startsWith("Bearer ")) return auth.slice(7).trim();
  return null;
}

function getSessionCookie(c: Context): string | null {
  const token = getCookie(c, AUTH_COOKIE_NAME);
  return token?.trim() || null;
}

export async function resolveSession(c: Context): Promise<AuthSession | null> {
  const token = getSessionCookie(c);
  if (!token) return null;

  const now = new Date();
  const tokenHash = hashAuthValue(token);

  const loadSession = () =>
    withPrismaReconnect((client) =>
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
              solanaWalletAddress: true,
            },
          },
        },
      }),
    );
  type SessionRecord = NonNullable<Awaited<ReturnType<typeof loadSession>>>;

  // This lookup runs on EVERY authenticated request, so read through the cache.
  // `getCachedSession` revives the date fields and returns null if anything is
  // off — it can only ever produce a miss, never an incorrect pass.
  let record: SessionRecord | null =
    await getCachedSession<SessionRecord>(tokenHash);

  if (!record) {
    record = await loadSession();
    if (record) await setCachedSession(tokenHash, record);
  }

  if (!record || record.revokedAt || record.expiresAt <= now) {
    return null;
  }

  const staleAfter = 6 * 60 * 60 * 1000;
  if (now.getTime() - record.lastSeenAt.getTime() > staleAfter) {
    const expiresAt = new Date(now.getTime() + AUTH_SESSION_TTL_MS);
    await withPrismaReconnect((client) =>
      client.authSession.update({
        where: { id: record.id },
        data: { lastSeenAt: now, expiresAt },
      }),
    );
    // The cached copy still holds the previous expiresAt; drop it so the
    // sliding window is not silently shortened for this session.
    await invalidateSessionCache(tokenHash);

    return {
      sessionId: record.id,
      userId: record.user.id,
      email: record.user.email ?? null,
      currentTeamId: record.user.currentTeamId ?? null,
      activeEnvironmentId: record.activeEnvironmentId ?? null,
      walletAddress: record.user.walletAddress ?? null,
      stellarWalletAddress: record.user.stellarWalletAddress ?? null,
      solanaWalletAddress: record.user.solanaWalletAddress ?? null,
      expiresAt,
    };
  }

  return {
    sessionId: record.id,
    userId: record.user.id,
    email: record.user.email ?? null,
    currentTeamId: record.user.currentTeamId ?? null,
    activeEnvironmentId: record.activeEnvironmentId ?? null,
    walletAddress: record.user.walletAddress ?? null,
    stellarWalletAddress: record.user.stellarWalletAddress ?? null,
    solanaWalletAddress: record.user.solanaWalletAddress ?? null,
    expiresAt: record.expiresAt,
  };
}

export interface TeamContext {
  teamId: string;
  teamRole: string;
  userId: string;
  walletAddress?: string;
  stellarWalletAddress?: string;
  solanaWalletAddress?: string;
}

export async function resolveTeamContext(session: AuthSession): Promise<TeamContext | null> {
  const user = await withPrismaReconnect((client) =>
    client.user.findUnique({
      where: { id: session.userId },
      select: { id: true, walletAddress: true, stellarWalletAddress: true, solanaWalletAddress: true, currentTeamId: true },
    }),
  );
  if (!user) return null;

  const targetTeamId = user.currentTeamId ?? undefined;
  const membership = await withPrismaReconnect((client) =>
    client.teamMember.findFirst({
      where: {
        userId: user.id,
        ...(targetTeamId ? { teamId: targetTeamId } : {}),
      },
      orderBy: { createdAt: "asc" },
      select: { teamId: true, role: true },
    }),
  );

  if (!membership) return null;
  return {
    teamId: membership.teamId,
    teamRole: membership.role as string,
    userId: user.id,
    walletAddress: user.walletAddress ?? undefined,
    stellarWalletAddress: user.stellarWalletAddress ?? undefined,
    solanaWalletAddress: user.solanaWalletAddress ?? undefined,
  };
}

export type Permission =
  | "catalog:read" | "catalog:write"
  | "templates:read" | "templates:write" | "templates:install"
  | "invoices:read" | "invoices:write" | "invoices:send"
  | "audit:read" | "environment:switch"
  | "support:read" | "support:write";

const ALL_PERMISSIONS: Permission[] = [
  "catalog:read", "catalog:write",
  "templates:read", "templates:write", "templates:install",
  "invoices:read", "invoices:write", "invoices:send",
  "audit:read", "environment:switch",
  "support:read", "support:write",
];

const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  OWNER: ALL_PERMISSIONS,
  ADMIN: [
    "catalog:read", "catalog:write",
    "templates:read", "templates:write", "templates:install",
    "invoices:read", "invoices:write", "invoices:send",
    "audit:read", "environment:switch",
  ],
  FINANCE: ["invoices:read", "invoices:write", "invoices:send", "audit:read"],
  DEVELOPER: [
    "catalog:read", "catalog:write",
    "templates:read", "templates:write", "templates:install",
    "invoices:read",
  ],
  SUPPORT: ["catalog:read", "templates:read", "invoices:read", "audit:read", "support:read"],
  MEMBER: ["catalog:read", "templates:read", "invoices:read"],
};

function hasPermission(role: string, permission: Permission): boolean {
  const permissions = ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.MEMBER;
  return permissions.includes(permission);
}

export interface AuthorizedContext {
  session: AuthSession;
  team: TeamContext;
}

export function requirePermission(permission: Permission) {
  return async (c: Context, next: Next) => {
    const session = await resolveSession(c);
    if (!session) {
      return c.json({ ok: false, error: "Unauthorized", code: "UNAUTHORIZED" }, 401 as any);
    }

    const team = await resolveTeamContext(session);
    if (!team) {
      return c.json({ ok: false, error: "No team found", code: "FORBIDDEN" }, 403 as any);
    }

    if (!hasPermission(team.teamRole, permission)) {
      return c.json({ ok: false, error: "Forbidden", code: "FORBIDDEN" }, 403 as any);
    }

    // Write operations require an active platform key (Read-only mode enforcement)
    // Platform administrators are ALWAYS unlocked and exempt!
    const isWrite = permission.endsWith(":write") || permission.endsWith(":send") || permission.endsWith(":install");
    if (isWrite && !isPlatformAdminEmail(session.email)) {
      const teamRecord = await withPrismaReconnect((client) =>
        client.team.findUnique({
          where: { id: team.teamId },
          select: {
            isPlatformActivated: true,
            activationKeyId: true,
            activationKey: { select: { status: true, expiresAt: true } },
          },
        })
      );
      const isRevoked = teamRecord?.activationKey?.status === "REVOKED";
      const isExpired =
        teamRecord?.activationKey?.status === "EXPIRED" ||
        Boolean(teamRecord?.activationKey?.expiresAt && new Date(teamRecord.activationKey.expiresAt) < new Date());
      const isActivated =
        Boolean(teamRecord?.isPlatformActivated) &&
        !isRevoked &&
        !isExpired &&
        Boolean(teamRecord?.activationKeyId);

      if (!isActivated) {
        return c.json(
          {
            ok: false,
            error: "This workspace is in read-only mode. An active Platform Activation Key is required to perform modifications.",
            code: "ACTIVATION_REQUIRED",
            reason: isRevoked ? "KEY_REVOKED" : isExpired ? "KEY_EXPIRED" : "UNACTIVATED",
          },
          403 as any
        );
      }
    }

    c.set("session", session);
    c.set("team", team);
    await next();
  };
}

export function requireFacilitatorAuth() {
  return async (c: Context, next: Next) => {
    const secret = (process.env.FACILITATOR_SECRET || "").trim();

    if (!secret) {
      if (process.env.NODE_ENV === "production") {
        return c.json({
          error: "FACILITATOR_SECRET is not configured. Internal endpoints are disabled in production.",
        }, 503 as any);
      }
      await next();
      return;
    }

    // SECURITY: constant-time comparison. `!==` on a shared secret leaks the
    // secret byte-by-byte through response timing.
    if (!verifyFacilitatorToken(c.req.raw.headers)) {
      return c.json({ error: "Forbidden" }, 403 as any);
    }

    await next();
  };
}

export function requireApiKeyAuth() {
  return async (c: Context, next: Next) => {
    const auth = c.req.header("authorization") ?? c.req.header("x-api-key");
    if (!auth) {
      return c.json({ ok: false, error: "Missing API key. Provide Authorization: Bearer sk_/pk_/rk_xxx", code: "UNAUTHORIZED" }, 401 as any);
    }

    const raw = auth.startsWith("Bearer ") ? auth.slice(7).trim() : auth.trim();
    if (!isApiKeyToken(raw)) {
      return c.json({ ok: false, error: "Invalid API key format", code: "UNAUTHORIZED" }, 401 as any);
    }

    const hash = createHash("sha256").update(raw).digest("hex");

    // SECURITY: revocation, expiry and key-type must ALL be enforced here.
    // A previous version looked the key up but never read `revokedAt` /
    // `expiresAt` / `type`, so a revoked or expired key still authenticated,
    // and a browser-safe `pk_` publishable key could reach secret-only routes.
    const apiKey = await withPrismaReconnect((client) =>
      client.arcenApiKey.findUnique({
        where: { keyHash: hash },
        select: {
          id: true,
          teamId: true,
          type: true,
          revokedAt: true,
          expiresAt: true,
        },
      }),
    );

    if (!apiKey || apiKey.revokedAt) {
      return c.json({ ok: false, error: "Invalid or revoked API key", code: "UNAUTHORIZED" }, 401 as any);
    }

    if (apiKey.expiresAt && apiKey.expiresAt.getTime() <= Date.now()) {
      return c.json({ ok: false, error: "API key has expired", code: "UNAUTHORIZED" }, 401 as any);
    }

    // This middleware guards server-side routes only. Publishable keys are
    // explicitly client-safe and must never reach them.
    if (apiKey.type === "PUBLISHABLE") {
      return c.json(
        {
          ok: false,
          error: "This endpoint cannot be called with a publishable key",
          code: "FORBIDDEN",
        },
        403 as any,
      );
    }

    withPrismaReconnect((client) =>
      client.arcenApiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } }),
    ).catch((err) => {
      console.warn("[auth] Failed to update api key lastUsedAt:", err);
    });

    c.set("apiKeyTeamId", apiKey.teamId);
    c.set("apiKeyId", apiKey.id);
    await next();
  };
}

/**
 * Platform admin authentication.
 *
 * TWO INDEPENDENT PATHS — both fail closed:
 *
 *  A. Session path — an authenticated dashboard session whose user email is in
 *     the platform-admin allow-list. This is how the admin UI authenticates.
 *
 *  B. Headless path — an exact match of `PLATFORM_ADMIN_SECRET` supplied as
 *     `x-admin-secret`, `Authorization: Bearer …`, or the `arcen_admin_secret`
 *     cookie. This is how CLI scripts authenticate.
 *
 * SECURITY FIXES over the previous implementation:
 *  - Secret comparisons are constant-time (`secureCompare`), not `===`.
 *  - The cookie branch parses the cookie and compares the exact value. The old
 *    `cookie.includes("...=SECRET")` was a substring match that would accept
 *    `arcen_admin_secret=SECRET<attacker-suffix>`.
 *  - The unreachable "fall through and authorise anyway" branch is gone. It
 *    ran in production exactly when the secret check FAILED, i.e. it turned a
 *    failed secret verification into a success.
 */
export function requireAdminAuth() {
  return async (c: Context, next: Next) => {
    const headerSecret = c.req.header("x-admin-secret");
    const bearer = getBearerToken(c);
    const cookieSecret = readCookieValue(
      c.req.header("cookie"),
      ADMIN_SECRET_COOKIE_NAME,
    );

    const hasValidHeadlessSecret =
      secureCompare(headerSecret, PLATFORM_ADMIN_SECRET) ||
      secureCompare(bearer, PLATFORM_ADMIN_SECRET) ||
      secureCompare(cookieSecret, PLATFORM_ADMIN_SECRET);

    // ── Path B: headless secret (no session required) ──────────────────────
    if (hasValidHeadlessSecret) {
      c.set("adminAuthorized", true);
      await next();
      return;
    }

    // ── Path A: authenticated session belonging to an allow-listed admin ───
    const session = await resolveSession(c);
    if (session && isPlatformAdminEmail(session.email)) {
      c.set("adminAuthorized", true);
      c.set("adminUserId", session.userId);
      c.set("adminEmail", session.email);
      await next();
      return;
    }

    if (session) {
      return c.json(
        {
          ok: false,
          error: "Forbidden. Platform administrator privileges required.",
          code: "ADMIN_FORBIDDEN",
        },
        403 as any,
      );
    }

    return c.json(
      {
        ok: false,
        error: "Unauthorized. Admin authentication required.",
        code: "ADMIN_UNAUTHORIZED",
      },
      401 as any,
    );
  };
}

