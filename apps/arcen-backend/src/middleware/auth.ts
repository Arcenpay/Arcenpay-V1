import { createHmac, createHash } from "node:crypto";
import type { Context, Next } from "hono";
import { db, withPrismaReconnect } from "../db.js";
import { SIWE_JWT_SECRET } from "../config.js";

const AUTH_COOKIE_NAME = "arcen_session";
const AUTH_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface AuthSession {
  sessionId: string;
  userId: string;
  email: string | null;
  currentTeamId: string | null;
  activeEnvironmentId: string | null;
  walletAddress: string | null;
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
  const cookie = c.req.header("cookie");
  if (!cookie) return null;
  const match = cookie.match(new RegExp(`${AUTH_COOKIE_NAME}=([^;]+)`));
  return match ? match[1].trim() : null;
}

export async function resolveSession(c: Context): Promise<AuthSession | null> {
  const token = getSessionCookie(c);
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
        data: { lastSeenAt: now, expiresAt },
      }),
    );

    return {
      sessionId: record.id,
      userId: record.user.id,
      email: record.user.email ?? null,
      currentTeamId: record.user.currentTeamId ?? null,
      activeEnvironmentId: record.activeEnvironmentId ?? null,
      walletAddress: record.user.walletAddress ?? null,
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
    expiresAt: record.expiresAt,
  };
}

export interface TeamContext {
  teamId: string;
  teamRole: string;
  userId: string;
  walletAddress?: string;
}

export async function resolveTeamContext(session: AuthSession): Promise<TeamContext | null> {
  const user = await withPrismaReconnect((client) =>
    client.user.findUnique({
      where: { id: session.userId },
      select: { id: true, walletAddress: true, currentTeamId: true },
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

    const token = getBearerToken(c);
    if (token !== secret) {
      return c.json({ error: "Forbidden" }, 403 as any);
    }

    await next();
  };
}

export function requireApiKeyAuth() {
  return async (c: Context, next: Next) => {
    const auth = c.req.header("authorization") ?? c.req.header("x-api-key");
    if (!auth) {
      return c.json({ ok: false, error: "Missing API key. Provide Authorization: Bearer api_xxx", code: "UNAUTHORIZED" }, 401 as any);
    }

    const raw = auth.startsWith("Bearer ") ? auth.slice(7).trim() : auth.trim();
    if (!raw.startsWith("api_")) {
      return c.json({ ok: false, error: "Invalid API key format", code: "UNAUTHORIZED" }, 401 as any);
    }

    const hash = createHash("sha256").update(raw).digest("hex");

    const apiKey = await withPrismaReconnect((client) =>
      client.arcenApiKey.findUnique({
        where: { keyHash: hash },
        select: { id: true, teamId: true },
      }),
    );

    if (!apiKey) {
      return c.json({ ok: false, error: "Invalid or revoked API key", code: "UNAUTHORIZED" }, 401 as any);
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
