// ============================================================
//  Dashboard — Server-only auth helpers
//  Calls the ArcenPay Backend API (no direct DB access).
// ============================================================

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { BACKEND_URL } from "@/lib/config";
import { isPlatformAdminEmail } from "@/lib/admin";

export type DashboardSession = {
  sessionId: string;
  userId: string;
  clerkUserId: string;
  email: string | null;
  isPlatformAdmin?: boolean;
  currentTeamId: string | null;
  walletAddress: string | null;
  stellarWalletAddress: string | null;
  currentTeamRole: string | null;
  isPlatformActivated?: boolean;
  activationKeyStatus?: "ACTIVE" | "EXPIRED" | "REVOKED" | "UNACTIVATED";
  platformTier?: string;
  allowPlatformBilling?: boolean;
  activationKeyId?: string | null;
  currentTeam?: {
    id: string;
    name: string;
    slug: string;
    role: string | null;
    platformTier?: string;
    isPlatformActivated?: boolean;
    activationKeyStatus?: "ACTIVE" | "EXPIRED" | "REVOKED" | "UNACTIVATED";
    allowPlatformBilling?: boolean;
    activationKeyId?: string | null;
  } | null;
  activeEnvironment: {
    id: string;
    name: string;
    mode: "DEVELOPMENT" | "PRODUCTION";
    chainId: number;
    chainLabel: string;
    isActive: boolean;
  } | null;
  environments: Array<{
    id: string;
    name: string;
    mode: "DEVELOPMENT" | "PRODUCTION";
    chainId: number;
    chainLabel: string;
    isActive: boolean;
  }>;
  expiresAt: Date;
};

type BackendSessionResponse = {
  user?: {
    id?: string;
    email?: string | null;
    walletAddress?: string | null;
    stellarWalletAddress?: string | null;
    isPlatformAdmin?: boolean;
  };
  currentTeam?: {
    id?: string;
    name?: string;
    slug?: string;
    role?: string;
    platformTier?: string;
    isPlatformActivated?: boolean;
    activationKeyStatus?: "ACTIVE" | "EXPIRED" | "REVOKED" | "UNACTIVATED";
    allowPlatformBilling?: boolean;
    activationKeyId?: string | null;
  } | null;
  activeEnvironment?: {
    id: string;
    name: string;
    mode: "DEVELOPMENT" | "PRODUCTION";
    chainId: number;
    chainLabel: string;
    isActive: boolean;
  } | null;
  environments?: Array<{
    id: string;
    name: string;
    mode: "DEVELOPMENT" | "PRODUCTION";
    chainId: number;
    chainLabel: string;
    isActive: boolean;
  }>;
};

export async function callBackend<T>(path: string, options: RequestInit = {}): Promise<T | null> {
  const store = await cookies();
  const token = store.get("arcen_session")?.value;
  const headers: Record<string, string> = { ...(options.headers as Record<string, string> ?? {}) };
  if (token) headers.cookie = `arcen_session=${token}`;

  try {
    const res = await fetch(`${BACKEND_URL}${path}`, {
      ...options,
      headers,
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.data ?? data;
  } catch (error) {
    if (path !== "/api/v1/auth/session") {
      const detail =
        error instanceof Error ? error.message : String(error ?? "unknown error");
      console.error(
        `[auth.server] Backend request failed for ${path} via ${BACKEND_URL}: ${detail}`,
      );
    }
    return null;
  }
}

export async function getSession(): Promise<DashboardSession | null> {
  const store = await cookies();
  const token = store.get("arcen_session")?.value;
  if (!token) return null;

  const data = await callBackend<BackendSessionResponse>("/api/v1/auth/session");
  if (!data?.user?.id) return null;

  const isPlatformAdmin =
    data.user.isPlatformAdmin === true ||
    isPlatformAdminEmail(data.user.email);

  return {
    sessionId: "",
    userId: data.user.id,
    clerkUserId: data.user.id,
    email: data.user.email ?? null,
    isPlatformAdmin,
    currentTeamId: data.currentTeam?.id ?? null,
    walletAddress: data.user.walletAddress ?? null,
    stellarWalletAddress: data.user.stellarWalletAddress ?? null,
    currentTeamRole: data.currentTeam?.role ?? null,
    isPlatformActivated: isPlatformAdmin ? true : (data.currentTeam?.isPlatformActivated ?? false),
    activationKeyStatus: isPlatformAdmin
      ? "ACTIVE"
      : data.currentTeam?.activationKeyStatus ?? (data.currentTeam?.isPlatformActivated ? "ACTIVE" : "UNACTIVATED"),
    platformTier: data.currentTeam?.platformTier ?? "FREE",
    allowPlatformBilling: data.currentTeam?.allowPlatformBilling ?? true,
    activationKeyId: data.currentTeam?.activationKeyId ?? null,
    currentTeam: data.currentTeam
      ? {
          id: data.currentTeam.id ?? "",
          name: data.currentTeam.name ?? "",
          slug: data.currentTeam.slug ?? "",
          role: data.currentTeam.role ?? null,
          platformTier: data.currentTeam.platformTier,
          isPlatformActivated: isPlatformAdmin ? true : data.currentTeam.isPlatformActivated,
          activationKeyStatus: isPlatformAdmin
            ? "ACTIVE"
            : data.currentTeam.activationKeyStatus ?? (data.currentTeam.isPlatformActivated ? "ACTIVE" : "UNACTIVATED"),
          allowPlatformBilling: data.currentTeam.allowPlatformBilling,
          activationKeyId: data.currentTeam.activationKeyId,
        }
      : null,
    activeEnvironment: data.activeEnvironment ?? null,
    environments: Array.isArray(data.environments) ? data.environments : [],
    expiresAt: new Date(),
  };
}

export async function requirePageSession(next = "/login"): Promise<DashboardSession> {
  const session = await getSession();
  if (!session) redirect(next);
  return session;
}

export async function requireAdminSession(next = "/login?redirect=/admin"): Promise<DashboardSession> {
  const session = await getSession();
  if (!session) redirect(next);
  if (!session.isPlatformAdmin) redirect("/");
  return session;
}

export async function createSession(userId: string): Promise<DashboardSession> {
  const res = await fetch(`${BACKEND_URL}/api/v1/auth/session`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId }),
  });
  if (!res.ok) throw new Error("Failed to create session");
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) {
    const store = await cookies();
    const match = setCookie.match(/arcen_session=([^;]+)/);
    if (match) store.set("arcen_session", match[1], {
      httpOnly: true, sameSite: "lax",
      secure: process.env.NODE_ENV === "production", path: "/", maxAge: 30 * 24 * 60 * 60,
    });
  }
  const data = await res.json();
  const session = data.data ?? data;
  return {
    sessionId: session.sessionId ?? "",
    userId: session.userId ?? "",
    clerkUserId: session.userId ?? "",
    email: session.email ?? null,
    currentTeamId: session.currentTeamId ?? null,
    walletAddress: session.walletAddress ?? null,
    stellarWalletAddress: session.stellarWalletAddress ?? null,
    currentTeamRole: null,
    activeEnvironment: null,
    environments: [],
    expiresAt: new Date(session.expiresAt ?? Date.now()),
  };
}

export async function refreshSession(_sessionId: string): Promise<void> {
  const store = await cookies();
  const token = store.get("arcen_session")?.value;
  if (token) store.set("arcen_session", token, {
    httpOnly: true, sameSite: "lax",
    secure: process.env.NODE_ENV === "production", path: "/", maxAge: 30 * 24 * 60 * 60,
  });
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  const token = store.get("arcen_session")?.value;
  const headers: Record<string, string> = {};
  if (token) headers.cookie = `arcen_session=${token}`;

  await fetch(`${BACKEND_URL}/api/v1/auth/logout`, {
    method: "POST",
    headers,
  });
  store.delete("arcen_session");
}

export type ClerkSession = DashboardSession;
export type SessionPayload = DashboardSession;
