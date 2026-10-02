import { getRedis } from "../redis.js";

/**
 * Session cache.
 *
 * `resolveSession()` runs on EVERY authenticated request and does a DB lookup
 * plus a user join. This cache removes that round-trip.
 *
 * SAFETY — this is auth, so the rules are stricter than a normal cache:
 *  1. JSON round-trips Dates into strings. `resolveSession` compares
 *     `expiresAt <= now` as Dates, so a missed rehydration would silently
 *     accept expired sessions. Every date field is revived, and anything that
 *     does not revive cleanly is a CACHE MISS — never a pass.
 *  2. Only positive results are cached, with a short TTL. Revocation must
 *     invalidate explicitly (see `invalidateSessionCache`) with the TTL as the
 *     backstop, never the mechanism.
 *  3. Any Redis error is a cache miss.
 */

const PREFIX = "arcenpay:session:";
const TTL_SECONDS = 15;

const DATE_FIELDS = [
  "expiresAt",
  "revokedAt",
  "lastSeenAt",
  "createdAt",
  "updatedAt",
] as const;

function reviveDates<T>(raw: unknown): T | null {
  if (!raw || typeof raw !== "object") return null;
  const record = { ...(raw as Record<string, unknown>) };

  for (const field of DATE_FIELDS) {
    const value = record[field];
    if (value === null || value === undefined) {
      record[field] = value ?? null;
      continue;
    }
    if (typeof value !== "string") return null; // unexpected shape → miss
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null; // fail safe → miss
    record[field] = date;
  }

  // `expiresAt` is required for the expiry check — without it we cannot decide.
  if (!(record.expiresAt instanceof Date)) return null;

  return record as T;
}

export async function getCachedSession<T>(tokenHash: string): Promise<T | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(PREFIX + tokenHash);
    if (raw === null) return null;
    return reviveDates<T>(JSON.parse(raw));
  } catch (err) {
    console.error("[session-cache] read failed, treating as miss:", err);
    return null;
  }
}

export async function setCachedSession(
  tokenHash: string,
  record: unknown,
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(
      PREFIX + tokenHash,
      JSON.stringify(record),
      "EX",
      TTL_SECONDS,
    );
  } catch (err) {
    console.error("[session-cache] write failed:", err);
  }
}

/**
 * Drop a session from the cache. MUST be called wherever a session is revoked,
 * deleted, or has its permissions/environment changed — otherwise the stale copy
 * keeps working until the TTL expires.
 */
export async function invalidateSessionCache(tokenHash: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.del(PREFIX + tokenHash);
  } catch (err) {
    console.error("[session-cache] invalidate failed:", err);
  }
}
