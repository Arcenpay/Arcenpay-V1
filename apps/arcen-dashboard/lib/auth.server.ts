// ============================================================
//  Dashboard — Server-only auth helpers
//  Only import this in API routes / Server Components.
// ============================================================

import { cookies } from "next/headers";
import { COOKIE_NAME, verifySession, type SessionPayload } from "./auth";

export type { SessionPayload };

/** Reads the session cookie and verifies the JWT — server-only */
export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySession(token);
}

/**
 * Returns the wallet address from a session regardless of auth method.
 * SIWE sessions always have an address; magic-link sessions may have one
 * if the user has linked their wallet.
 */
export function getSessionAddress(session: SessionPayload): string | undefined {
  return session.address;
}

/**
 * Returns the email from a session regardless of auth method.
 */
export function getSessionEmail(session: SessionPayload): string | undefined {
  if (session.authMethod === "magic") return session.email;
  return session.email;
}
