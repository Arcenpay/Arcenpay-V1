// ============================================================
//  Dashboard — Server-only auth helpers
//  Calls the ArcenPay Backend API (no direct DB access).
// ============================================================

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { BACKEND_URL } from "@/lib/config";

export type DashboardSession = {
  sessionId: string;
  userId: string;
  clerkUserId: string;
  email: string | null;
  currentTeamId: string | null;
  walletAddress: string | null;
  expiresAt: Date;
};

type BackendSessionResponse = {
  user?: {
    id?: string;
    email?: string | null;
    walletAddress?: string | null;
  };
  currentTeam?: {
    id?: string;
  } | null;
};

async function callBackend<T>(path: string, options: RequestInit = {}): Promise<T | null> {
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

  return {
    sessionId: "",
    userId: data.user.id,
    clerkUserId: data.user.id,
    email: data.user.email ?? null,
    currentTeamId: data.currentTeam?.id ?? null,
    walletAddress: data.user.walletAddress ?? null,
    expiresAt: new Date(),
  };
}

export async function requirePageSession(next = "/login"): Promise<DashboardSession> {
  const session = await getSession();
  if (!session) redirect(next);
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
  return { sessionId: session.sessionId ?? "", userId: session.userId ?? "", clerkUserId: session.userId ?? "", email: session.email ?? null, currentTeamId: session.currentTeamId ?? null, walletAddress: session.walletAddress ?? null, expiresAt: new Date(session.expiresAt ?? Date.now()) };
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
