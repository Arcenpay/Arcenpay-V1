// ============================================================
//  Dashboard — Server-only auth helpers
//  Only import this in API routes / Server Components.
// ============================================================

import { cookies } from "next/headers";
import { COOKIE_NAME, verifySession } from "./auth";

/** Reads the session cookie and verifies the JWT — server-only */
export async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySession(token);
}
