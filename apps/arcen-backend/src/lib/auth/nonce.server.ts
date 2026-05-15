// ============================================================
//  Nonce helpers — server-only, DB-backed
//
//  The old in-memory Map in lib/auth.ts breaks in Next.js dev
//  mode because different route handlers can load separate
//  module instances, each with their own Map.  Storing nonces
//  in Postgres fixes this.
// ============================================================

import { randomBytes } from "crypto";
import { db } from "../../db.js";

const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export type NonceRecord = {
  issuedAt: string;
};

/** Creates a one-time SIWE nonce persisted in Postgres */
export async function generateNonce(): Promise<
  NonceRecord & { nonce: string }
> {
  const nonce = randomBytes(16).toString("hex");
  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + NONCE_TTL_MS);

  await db.authNonce.create({ data: { nonce, issuedAt, expiresAt } });

  // Clean up expired nonces opportunistically (best effort)
  db.authNonce
    .deleteMany({ where: { expiresAt: { lt: new Date() } } })
    .catch((err) => {
      console.warn("[nonce] Failed to clean up expired nonces:", err);
    });

  return { nonce, issuedAt };
}

/**
 * Validates and atomically consumes a nonce (one-time use).
 * Returns the stored record on success, null on any failure.
 */
export async function consumeNonce(nonce: string): Promise<NonceRecord | null> {
  const now = new Date();

  return db.$transaction(async (tx) => {
    const record = await tx.authNonce.findUnique({
      where: { nonce },
      select: {
        nonce: true,
        issuedAt: true,
        expiresAt: true,
        usedAt: true,
      },
    });
    if (!record) return null;
    if (record.usedAt !== null) return null;
    if (now > record.expiresAt) return null;

    const consumed = await tx.authNonce.updateMany({
      where: {
        nonce,
        usedAt: null,
        expiresAt: { gt: now },
      },
      data: { usedAt: now },
    });

    if (consumed.count !== 1) {
      return null;
    }

    return { issuedAt: record.issuedAt };
  });
}
