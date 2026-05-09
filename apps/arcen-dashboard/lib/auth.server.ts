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

async function callBackend<T>(path: string, options: RequestInit = {}): Promise<T | null> {
  const store = await cookies();
  const token = store.get("arcen_session")?.value;
  const headers: Record<string, string> = { ...(options.headers as Record<string, string> ?? {}) };
  if (token) headers.cookie = `arcen_session=${token}`;

  const res = await fetch(`${BACKEND_URL}${path}`, { ...options, headers, cache: "no-store" });
  if (!res.ok) return null;
  const data = await res.json();
  return data.data ?? data;
}

export async function getSession(): Promise<DashboardSession | null> {
  const store = await cookies();
  const token = store.get("arcen_session")?.value;
  if (!token) return null;

  const data = await callBackend<{
    authenticated: boolean; userId?: string; email?: string | null;
    walletAddress?: string | null; currentTeamId?: string | null;
  }>("/api/v1/auth/session");

  if (!data || !data.authenticated) return null;
  return {
    sessionId: "", userId: data.userId ?? "", clerkUserId: data.userId ?? "",
    email: data.email ?? null, currentTeamId: data.currentTeamId ?? null,
    walletAddress: data.walletAddress ?? null, expiresAt: new Date(),
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
  await fetch(`${BACKEND_URL}/api/v1/auth/logout`, { method: "POST" });
  const store = await cookies();
  store.delete("arcen_session");
}

export type ClerkSession = DashboardSession;
export type SessionPayload = DashboardSession;
