// ============================================================
//  Dashboard — Server-only auth helpers (Clerk-based)
//  Only import this in API routes / Server Components.
// ============================================================

import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";

export type ClerkSession = {
  clerkUserId: string;
  orgId: string | null;
};

/** Reads the Clerk session — server-only. Returns null if unauthenticated. */
export async function getSession(): Promise<ClerkSession | null> {
  const { userId, orgId } = await auth();
  if (!userId) return null;
  return { clerkUserId: userId, orgId: orgId ?? null };
}

/** Fetches the DB User record for the given Clerk user ID. */
export async function getDbUser(clerkUserId: string) {
  return db.user.findUnique({ where: { clerkUserId } });
}

// SessionPayload alias for any files that still import it by the old name
export type SessionPayload = ClerkSession;
